import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createBridgeApp } from '../src/bridge/server.js'
import { SqliteAdapter } from '../src/adapters/sqlite.js'
import { BridgeEventBus } from '../src/bridge/events.js'

describe('Cashier Bridge EventBus', () => {
  let bus: BridgeEventBus

  beforeEach(() => {
    bus = new BridgeEventBus()
  })

  afterEach(() => {
    bus.destroy()
  })

  it('manages clients and broadcasts SSE formatted messages', () => {
    const received: string[] = []
    const client = {
      id: 'cashier-1',
      write: (data: string) => {
        received.push(data)
      },
      close: () => {},
    }

    bus.addClient(client)
    expect(bus.clientCount).toBe(1)
    expect(received[0]).toContain('event: connected')

    bus.broadcast('payment:settled', { receipt: 'TEST123', amount: 500 })
    expect(received).toHaveLength(2)
    expect(received[1]).toContain('event: payment:settled')
    expect(received[1]).toContain('"receipt":"TEST123"')

    bus.removeClient('cashier-1')
    expect(bus.clientCount).toBe(0)
  })
})

describe('Cashier Bridge HTTP Endpoints', () => {
  let storage: SqliteAdapter
  let app: ReturnType<typeof createBridgeApp>['app']

  beforeEach(() => {
    storage = new SqliteAdapter(':memory:')
    const bridge = createBridgeApp({
      storage,
      simulatedMode: true,
    })
    app = bridge.app
  })

  afterEach(() => {
    storage.close()
  })

  it('serves the Cashier Terminal HTML at GET /', async () => {
    const res = await app.request('/')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('M-Pesa Daraja Payment Bridge')
    expect(html).toContain('Supermarket Message Store')
  })

  it('rejects invalid prompt params with 400', async () => {
    // Negative amount
    const res1 = await app.request('/api/payments/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: -50, phoneNumber: '0712345678' }),
    })
    expect(res1.status).toBe(400)
    const data1 = await res1.json()
    expect(data1.error).toContain('Amount must be a positive number')

    // Invalid phone number
    const res2 = await app.request('/api/payments/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 1500, phoneNumber: '12345' }),
    })
    expect(res2.status).toBe(400)
    const data2 = await res2.json()
    expect(data2.error).toContain('Invalid phone number')
  })

  it('initiates an STK prompt in simulated mode and returns PENDING state', async () => {
    const res = await app.request('/api/payments/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 1500,
        phoneNumber: '0712345678',
        billReference: 'INV-301',
      }),
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('PENDING')
    expect(data.paymentId).toBeDefined()
    expect(data.checkoutRequestId).toBeDefined()
    expect(data.simulated).toBe(true)

    // Stored in SQLite
    const stored = await storage.getPayment(data.paymentId)
    expect(stored).not.toBeNull()
    expect(stored?.amount).toBe(1500)
    expect(stored?.phoneNumber).toBe('254712345678')
    expect(stored?.accountReference).toBe('INV-301')
  })

  it('ingests C2B Confirmation webhooks and exposes them in the feed', async () => {
    const c2bPayload = {
      TransactionType: 'Buy Goods',
      TransID: 'RKT912345',
      TransTime: '20261026074512',
      TransAmount: '3500.00',
      BusinessShortCode: '543210',
      BillRefNumber: 'PHARM-88',
      MSISDN: '0722112233',
      FirstName: 'ESTHER',
      LastName: 'MUTUA',
    }

    const res = await app.request('/webhooks/c2b/confirmation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(c2bPayload),
    })

    expect(res.status).toBe(200)
    const ack = await res.json()
    expect(ack.ResultCode).toBe(0)

    // Verify it is queryable in the message store feed
    const feedRes = await app.request('/api/payments/feed')
    expect(feedRes.status).toBe(200)
    const feed = await feedRes.json()
    expect(feed.payments).toHaveLength(1)
    expect(feed.payments[0].mpesaReceiptNumber).toBe('RKT912345')
    expect(feed.payments[0].amount).toBe(3500)
    expect(feed.payments[0].customerName).toBe('ESTHER MUTUA')
  })

  it('searches the message store feed by receipt code suffix and phone', async () => {
    // Insert 2 transactions
    await app.request('/webhooks/c2b/confirmation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        TransID: 'AAA111KL9',
        TransTime: '20261026074512',
        TransAmount: 1000,
        BusinessShortCode: '543210',
        MSISDN: '0712345678',
        FirstName: 'JOHN',
      }),
    })
    await app.request('/webhooks/c2b/confirmation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        TransID: 'BBB222XY8',
        TransTime: '20261026074512',
        TransAmount: 2000,
        BusinessShortCode: '543210',
        MSISDN: '0799887766',
        FirstName: 'MARY',
      }),
    })

    // Search by receipt code suffix
    const searchRes1 = await app.request('/api/payments/feed?search=KL9')
    const search1 = await searchRes1.json()
    expect(search1.payments).toHaveLength(1)
    expect(search1.payments[0].mpesaReceiptNumber).toBe('AAA111KL9')

    // Search by phone
    const searchRes2 = await app.request('/api/payments/feed?search=998877')
    const search2 = await searchRes2.json()
    expect(search2.payments).toHaveLength(1)
    expect(search2.payments[0].mpesaReceiptNumber).toBe('BBB222XY8')
  })

  it('links/claims an unassigned payment to a bill reference', async () => {
    await app.request('/webhooks/c2b/confirmation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        TransID: 'UNCLAIMED1',
        TransTime: '20261026074512',
        TransAmount: 450,
        BusinessShortCode: '543210',
        MSISDN: '0712345678',
      }),
    })

    const claimRes = await app.request('/api/payments/c2b_UNCLAIMED1/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ billReference: 'PRESCRIPTION-999' }),
    })

    expect(claimRes.status).toBe(200)
    const claimData = await claimRes.json()
    expect(claimData.success).toBe(true)
    expect(claimData.payment.accountReference).toBe('PRESCRIPTION-999')
  })

  it('aggregates reconciliation metrics and exports clean bookkeeper CSV', async () => {
    // Add 2 confirmed payments
    await app.request('/webhooks/c2b/confirmation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        TransID: 'RECON1',
        TransTime: '20261026074512',
        TransAmount: 1200,
        BusinessShortCode: '543210',
        MSISDN: '0712345678',
      }),
    })
    await app.request('/webhooks/c2b/confirmation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        TransID: 'RECON2',
        TransTime: '20261026074512',
        TransAmount: 1800,
        BusinessShortCode: '543210',
        MSISDN: '0722334455',
      }),
    })

    // Summary endpoint
    const summaryRes = await app.request('/api/reconciliation/summary')
    expect(summaryRes.status).toBe(200)
    const summary = await summaryRes.json()
    expect(summary.totalAmount).toBe(3000)
    expect(summary.totalCount).toBe(2)
    expect(summary.c2bCount).toBe(2)

    // CSV export endpoint
    const csvRes = await app.request('/api/reconciliation/export.csv')
    expect(csvRes.status).toBe(200)
    expect(csvRes.headers.get('content-type')).toContain('text/csv')
    const csv = await csvRes.text()
    expect(csv).toContain('ReceiptNumber,Channel,CustomerName')
    expect(csv).toContain('RECON1')
    expect(csv).toContain('RECON2')
    expect(csv).toContain('1200')
    expect(csv).toContain('1800')
  })
})
