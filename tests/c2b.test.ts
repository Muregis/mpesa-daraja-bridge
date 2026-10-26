import { describe, it, expect, vi } from 'vitest'
import {
  processC2BConfirmation,
  processC2BValidation,
  formatCustomerName,
  parseTransTime,
  validateC2BPayload,
} from '../src/c2b.js'
import { MemoryAdapter } from '../src/adapters/memory.js'
import { SqliteAdapter } from '../src/adapters/sqlite.js'
import { MpesaStk } from '../src/client.js'
import type { MpesaConfig } from '../src/types.js'

const mockConfig: MpesaConfig = {
  consumerKey: 'test-key',
  consumerSecret: 'test-secret',
  shortCode: '600000',
  passKey: 'test-passkey',
  callbackUrl: 'https://example.com/callback',
  environment: 'sandbox',
}

describe('C2B Helper Functions', () => {
  it('formats customer name cleanly', () => {
    expect(formatCustomerName('JOHN', 'K', 'DOE')).toBe('JOHN K DOE')
    expect(formatCustomerName('JANE', undefined, 'M')).toBe('JANE M')
    expect(formatCustomerName(undefined, undefined, undefined)).toBe('Customer')
    expect(formatCustomerName('   ', '', undefined)).toBe('Customer')
  })

  it('parses Daraja TransTime format YYYYMMDDHHmmss', () => {
    const date = parseTransTime('20261026074512')
    expect(date.getUTCFullYear()).toBe(2026)
    expect(date.getUTCMonth()).toBe(9) // 0-indexed October
    expect(date.getUTCDate()).toBe(26)
    expect(date.getUTCHours()).toBe(7)
    expect(date.getUTCMinutes()).toBe(45)
    expect(date.getUTCSeconds()).toBe(12)
  })

  it('validates C2B payload structure correctly', () => {
    expect(validateC2BPayload(null)).toBe(false)
    expect(validateC2BPayload({})).toBe(false)
    expect(validateC2BPayload({
      TransID: 'RKT82LK91',
      TransAmount: '1500.00',
      MSISDN: '254712345678',
      BusinessShortCode: '600000',
    })).toBe(true)
  })
})

describe('processC2BConfirmation', () => {
  it('persists a new C2B payment with MemoryAdapter', async () => {
    const storage = new MemoryAdapter()
    const payload = {
      TransactionType: 'Pay Bill',
      TransID: 'LHG31AA5TX',
      TransTime: '20261026074512',
      TransAmount: '2500.00',
      BusinessShortCode: '600000',
      BillRefNumber: 'INV-402',
      MSISDN: '0712345678',
      FirstName: 'JAMES',
      LastName: 'OTIENO',
    }

    const result = await processC2BConfirmation(payload, storage)

    expect(result.isDuplicate).toBe(false)
    expect(result.receipt).toBe('LHG31AA5TX')
    expect(result.amount).toBe(2500)
    expect(result.phoneNumber).toBe('254712345678')
    expect(result.customerName).toBe('JAMES OTIENO')
    expect(result.status).toBe('SUCCESS')

    const stored = await storage.getPayment(result.paymentId)
    expect(stored).not.toBeNull()
    expect(stored?.accountReference).toBe('INV-402')
    expect(stored?.mpesaReceiptNumber).toBe('LHG31AA5TX')
  })

  it('persists a new C2B payment with SqliteAdapter and prevents duplicate insertion', async () => {
    const storage = new SqliteAdapter(':memory:')
    const payload = {
      TransactionType: 'Buy Goods',
      TransID: 'QJD998877',
      TransTime: '20261026074512',
      TransAmount: 1200,
      BusinessShortCode: '543210',
      MSISDN: '254722334455',
      FirstName: 'MARY',
      LastName: 'WANJIKU',
    }

    const first = await processC2BConfirmation(payload, storage)
    expect(first.isDuplicate).toBe(false)
    expect(first.receipt).toBe('QJD998877')
    expect(first.amount).toBe(1200)

    // Second callback arrives with same TransID (duplicate from Safaricom)
    const second = await processC2BConfirmation(payload, storage)
    expect(second.isDuplicate).toBe(true)
    expect(second.receipt).toBe('QJD998877')
    expect(second.paymentId).toBe(first.paymentId)

    storage.close()
  })

  it('rejects invalid or missing TransAmount', async () => {
    const storage = new MemoryAdapter()
    await expect(processC2BConfirmation({
      TransID: 'ABC12345',
      TransAmount: '-50',
      MSISDN: '254712345678',
      BusinessShortCode: '600000',
    }, storage)).rejects.toThrow(/Invalid C2B TransAmount/)
  })
})

describe('processC2BValidation', () => {
  it('accepts by default when no validator is supplied', () => {
    const response = processC2BValidation({
      TransID: 'XYZ123',
      TransAmount: '500',
      MSISDN: '254712345678',
      BusinessShortCode: '600000',
    })
    expect(response).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' })
  })

  it('allows custom validator to reject invalid account numbers', () => {
    const response = processC2BValidation({
      TransID: 'XYZ123',
      TransAmount: '500',
      MSISDN: '254712345678',
      BusinessShortCode: '600000',
      BillRefNumber: 'INVALID-BILL',
    }, (payload) => {
      if (payload.BillRefNumber === 'INVALID-BILL') {
        return { valid: false, reason: 'Bill number does not exist' }
      }
      return true
    })

    expect(response.ResultCode).toBe('C2B00012')
    expect(response.ResultDesc).toContain('Bill number does not exist')
  })
})

describe('MpesaStk C2B Integration', () => {
  it('triggers onPaymentSettled when a C2B payment is confirmed', async () => {
    const storage = new MemoryAdapter()
    const client = new MpesaStk(mockConfig, storage)

    const settledSpy = vi.fn()
    client.onPaymentSettled(settledSpy)

    await client.processC2BConfirmation({
      TransactionType: 'Pay Bill',
      TransID: 'NOTIF12345',
      TransTime: '20261026074512',
      TransAmount: '3500.00',
      BusinessShortCode: '600000',
      BillRefNumber: 'PHARMACY-88',
      MSISDN: '0700112233',
      FirstName: 'ESTHER',
      LastName: 'MUTUA',
    })

    expect(settledSpy).toHaveBeenCalledTimes(1)
    const recorded = settledSpy.mock.calls[0]?.[0]
    expect(recorded.mpesaReceiptNumber).toBe('NOTIF12345')
    expect(recorded.amount).toBe(3500)
    expect(recorded.customerName).toBe('ESTHER MUTUA')
    expect(recorded.status).toBe('SUCCESS')

    // Duplicate C2B should NOT fire onPaymentSettled again
    await client.processC2BConfirmation({
      TransactionType: 'Pay Bill',
      TransID: 'NOTIF12345',
      TransTime: '20261026074512',
      TransAmount: '3500.00',
      BusinessShortCode: '600000',
      MSISDN: '0700112233',
    })

    expect(settledSpy).toHaveBeenCalledTimes(1)
  })
})
