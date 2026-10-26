import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { randomUUID } from 'crypto'
import type { MpesaConfig, Logger, PaymentRecord } from '../types.js'
import type { StorageAdapter } from '../adapters/types.js'
import { SqliteAdapter } from '../adapters/sqlite.js'
import { MpesaStk } from '../client.js'
import { BridgeEventBus } from './events.js'
import { TERMINAL_HTML } from './html.js'
import { normalisePhoneNumber } from '../initiate.js'

export interface BridgeServerConfig {
  port?: number
  mpesaConfig?: MpesaConfig
  storage?: StorageAdapter
  logger?: Logger
  simulatedMode?: boolean
}

/**
 * Creates the complete Cashier Bridge Hono application.
 */
export function createBridgeApp(options: BridgeServerConfig = {}) {
  const app = new Hono()
  const eventBus = new BridgeEventBus()
  const storage: StorageAdapter = options.storage ?? new SqliteAdapter('mpesa.db')
  const simulatedMode = options.simulatedMode ?? (!options.mpesaConfig)

  // Configure MpesaStk engine
  const mpesa = options.mpesaConfig
    ? new MpesaStk(options.mpesaConfig, storage, options.logger)
    : new MpesaStk(
        {
          consumerKey: 'simulated_key',
          consumerSecret: 'simulated_secret',
          shortCode: '174379',
          passKey: 'simulated_passkey',
          callbackUrl: 'https://example.com/webhooks/stk',
          environment: 'sandbox',
        },
        storage,
        options.logger
      )

  // Wire up real-time broadcast: any settled payment (STK or C2B) goes to cashier screens immediately
  mpesa.onPaymentSettled((payment: PaymentRecord) => {
    eventBus.broadcast('payment:settled', payment)
  })

  // -------------------------------------------------------------------------
  // 1. Web Terminal UI
  // -------------------------------------------------------------------------
  app.get('/', (c) => c.html(TERMINAL_HTML))

  // -------------------------------------------------------------------------
  // 2. Real-Time Server-Sent Events (SSE) Stream
  // -------------------------------------------------------------------------
  app.get('/api/events', (c) => {
    return streamSSE(c, async (stream) => {
      const clientId = randomUUID()

      const sseClient = {
        id: clientId,
        write: (data: string) => {
          stream.write(data)
        },
        close: () => {
          eventBus.removeClient(clientId)
        },
      }

      eventBus.addClient(sseClient)

      // Keep stream active until client disconnects
      stream.onAbort(() => {
        eventBus.removeClient(clientId)
      })

      // Wait indefinitely while SSE connection is active
      while (true) {
        await stream.sleep(15000)
      }
    })
  })

  // -------------------------------------------------------------------------
  // 3. Cashier Actions: Prompt Customer Phone (STK Push)
  // -------------------------------------------------------------------------
  app.post('/api/payments/prompt', async (c) => {
    try {
      const body = await c.req.json()
      const rawAmount = Number(body.amount)
      const rawPhone = String(body.phoneNumber || '').trim()
      const billRef = String(body.billReference || 'POS-CHECKOUT').trim()
      const idempotencyKey = body.idempotencyKey || `pos_${Date.now()}_${randomUUID().slice(0, 8)}`

      if (isNaN(rawAmount) || rawAmount <= 0) {
        return c.json({ error: 'Amount must be a positive number' }, 400)
      }

      let normalisedPhone: string
      try {
        normalisedPhone = normalisePhoneNumber(rawPhone)
      } catch (err: any) {
        return c.json({ error: err.message }, 400)
      }

      // If simulated mode, generate an in-memory or database pending payment
      if (simulatedMode) {
        const paymentId = randomUUID()
        const checkoutRequestId = `ws_SIM_${Date.now()}`
        const record: PaymentRecord = {
          id: paymentId,
          checkoutRequestId,
          merchantRequestId: 'SIM_POS',
          phoneNumber: normalisedPhone,
          amount: Math.round(rawAmount),
          accountReference: billRef,
          status: 'PENDING',
          paymentType: 'STK_PUSH',
          initiatedAt: new Date(),
        }
        await storage.createPayment(record, idempotencyKey)

        // In simulated mode, automatically simulate customer entering PIN after 2 seconds
        setTimeout(async () => {
          const receiptCode = 'SIM' + Math.random().toString(36).substring(2, 9).toUpperCase()
          await storage.settlePayment(paymentId, {
            status: 'SUCCESS',
            mpesaReceiptNumber: receiptCode,
            resultCode: 0,
            completedAt: new Date(),
            customerName: 'SIMULATED CUSTOMER',
          })
          const settled = await storage.getPayment(paymentId)
          if (settled) {
            eventBus.broadcast('payment:settled', settled)
          }
        }, 2200)

        return c.json({
          paymentId,
          checkoutRequestId,
          status: 'PENDING',
          simulated: true,
        })
      }

      // Live / Sandbox STK Push via Daraja
      const result = await mpesa.initiatePayment({
        phoneNumber: normalisedPhone,
        amount: Math.round(rawAmount),
        accountReference: billRef,
        description: `Payment for ${billRef}`,
        idempotencyKey,
      })

      return c.json({
        paymentId: result.paymentId,
        checkoutRequestId: result.checkoutRequestId,
        status: 'PENDING',
        simulated: false,
      })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to initiate prompt' }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // 4. Live Message Store: Recent Payments Feed with Search
  // -------------------------------------------------------------------------
  app.get('/api/payments/feed', async (c) => {
    try {
      const search = c.req.query('search')
      const limit = Number(c.req.query('limit') || 50)
      const offset = Number(c.req.query('offset') || 0)

      let payments: PaymentRecord[]
      if (storage.getRecentPayments) {
        payments = await storage.getRecentPayments({ search, limit, offset })
      } else {
        // Fallback for standard adapters: fetch all success and filter
        const from = new Date(Date.now() - 7 * 86400 * 1000)
        const to = new Date()
        payments = await storage.getPaymentsByStatusAndDateRange(['SUCCESS', 'PENDING'], from, to)
        if (search) {
          const q = search.toLowerCase()
          payments = payments.filter((p) =>
            (p.mpesaReceiptNumber && p.mpesaReceiptNumber.toLowerCase().includes(q)) ||
            (p.phoneNumber && p.phoneNumber.includes(q)) ||
            (p.customerName && p.customerName.toLowerCase().includes(q)) ||
            (p.accountReference && p.accountReference.toLowerCase().includes(q))
          )
        }
      }

      return c.json({ payments })
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // 5. Cashier Claim / Link Payment to Bill
  // -------------------------------------------------------------------------
  app.post('/api/payments/:id/claim', async (c) => {
    try {
      const id = c.req.param('id')
      const body = await c.req.json()
      const billRef = String(body.billReference || '').trim()

      if (!billRef) {
        return c.json({ error: 'billReference is required' }, 400)
      }

      const payment = await storage.getPayment(id)
      if (!payment) {
        return c.json({ error: 'Payment not found' }, 404)
      }

      await storage.updatePayment(id, { accountReference: billRef })
      const updated = await storage.getPayment(id)

      if (updated) {
        eventBus.broadcast('payment:claimed', updated)
      }

      return c.json({ success: true, payment: updated })
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // 6. Safaricom Webhooks: STK Push & C2B (Till / Paybill)
  // -------------------------------------------------------------------------
  app.post('/webhooks/stk', async (c) => {
    try {
      const body = await c.req.json()
      const result = await mpesa.processCallback(body)
      return c.json({ ResultCode: 0, ResultDesc: 'Success', result })
    } catch (err: any) {
      return c.json({ ResultCode: 0, ResultDesc: 'Accepted with internal note', error: err.message })
    }
  })

  app.post('/webhooks/c2b/validation', async (c) => {
    try {
      const body = await c.req.json()
      const response = mpesa.processC2BValidation(body)
      return c.json(response)
    } catch {
      return c.json({ ResultCode: 0, ResultDesc: 'Accepted' })
    }
  })

  app.post('/webhooks/c2b/confirmation', async (c) => {
    try {
      const body = await c.req.json()
      const result = await mpesa.processC2BConfirmation(body)
      return c.json({ ResultCode: 0, ResultDesc: 'Accepted', result })
    } catch (err: any) {
      return c.json({ ResultCode: 0, ResultDesc: 'Accepted', error: err.message })
    }
  })

  // -------------------------------------------------------------------------
  // 7. Midnight Bookkeeper Reconciliation & CSV Export
  // -------------------------------------------------------------------------
  app.get('/api/reconciliation/summary', async (c) => {
    try {
      const startOfDay = new Date()
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date()
      endOfDay.setHours(23, 59, 59, 999)

      const payments = await storage.getPaymentsByStatusAndDateRange(
        ['SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT'],
        startOfDay,
        endOfDay
      )

      const successPayments = payments.filter((p) => p.status === 'SUCCESS')
      const totalAmount = successPayments.reduce((sum, p) => sum + p.amount, 0)
      const stkCount = successPayments.filter((p) => p.paymentType === 'STK_PUSH' || !p.paymentType).length
      const c2bCount = successPayments.filter((p) => p.paymentType === 'C2B').length

      return c.json({
        date: startOfDay.toISOString().split('T')[0],
        totalAmount,
        totalCount: successPayments.length,
        stkCount,
        c2bCount,
        failedCount: payments.filter((p) => p.status !== 'SUCCESS').length,
      })
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  app.get('/api/reconciliation/export.csv', async (c) => {
    try {
      const startOfDay = new Date(Date.now() - 30 * 86400 * 1000)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date()
      endOfDay.setHours(23, 59, 59, 999)

      const payments = await storage.getPaymentsByStatusAndDateRange(
        ['SUCCESS'],
        startOfDay,
        endOfDay
      )

      const headers = ['Date', 'Time', 'ReceiptNumber', 'Channel', 'CustomerName', 'PhoneNumber', 'Amount_KES', 'BillReference', 'Status']
      const rows = payments.map((p) => {
        const d = new Date(p.initiatedAt)
        return [
          d.toISOString().split('T')[0],
          d.toTimeString().split(' ')[0],
          p.mpesaReceiptNumber || p.checkoutRequestId,
          p.paymentType || 'STK_PUSH',
          `"${(p.customerName || 'Customer').replace(/"/g, '""')}"`,
          p.phoneNumber,
          p.amount,
          `"${(p.accountReference || '').replace(/"/g, '""')}"`,
          p.status,
        ].join(',')
      })

      const csvContent = [headers.join(','), ...rows].join('\r\n')

      return new Response(csvContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="mpesa-reconciliation.csv"',
        },
      })
    } catch (err: any) {
      return c.text(`Error: ${err.message}`, 500)
    }
  })

  // -------------------------------------------------------------------------
  // 8. Testing Simulator: Mock STK and Mock C2B Webhook Triggers
  // -------------------------------------------------------------------------
  app.post('/api/simulate/c2b', async (c) => {
    try {
      const mockNames = ['MARY WANJIKU', 'JOHN KAMAU', 'PETER OCHIENG', 'FATUMA HASSAN', 'ESTHER CHEBET']
      const randomName = mockNames[Math.floor(Math.random() * mockNames.length)]!
      const nameParts = randomName.split(' ')
      const randomAmount = [200, 500, 1200, 1500, 2400, 3500, 5000][Math.floor(Math.random() * 7)]!
      const receipt = 'SIM' + Math.random().toString(36).substring(2, 9).toUpperCase()

      const payload = {
        TransactionType: 'Buy Goods',
        TransID: receipt,
        TransTime: new Date().toISOString().replace(/\D/g, '').substring(0, 14),
        TransAmount: randomAmount,
        BusinessShortCode: '543210',
        BillRefNumber: `RX-${Math.floor(Math.random() * 900 + 100)}`,
        MSISDN: `2547${Math.floor(Math.random() * 89999999 + 10000000)}`,
        FirstName: nameParts[0],
        LastName: nameParts[1],
      }

      const result = await mpesa.processC2BConfirmation(payload)
      return c.json({ simulated: true, result })
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  app.post('/api/simulate/stk', async (c) => {
    try {
      const paymentId = randomUUID()
      const checkoutId = `ws_SIM_${Date.now()}`
      const receipt = 'STK' + Math.random().toString(36).substring(2, 9).toUpperCase()
      const amount = 2500

      const record: PaymentRecord = {
        id: paymentId,
        checkoutRequestId: checkoutId,
        merchantRequestId: 'SIM_MERCH',
        phoneNumber: '254712345678',
        amount,
        accountReference: 'INV-SIM',
        status: 'SUCCESS',
        mpesaReceiptNumber: receipt,
        customerName: 'JAMES MWANGI',
        paymentType: 'STK_PUSH',
        initiatedAt: new Date(),
        completedAt: new Date(),
      }

      await storage.createPayment(record)
      eventBus.broadcast('payment:settled', record)

      return c.json({ simulated: true, record })
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  return {
    app,
    storage,
    mpesa,
    eventBus,
  }
}
