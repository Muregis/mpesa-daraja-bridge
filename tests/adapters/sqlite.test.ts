import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteAdapter } from '../../src/adapters/sqlite.js'
import type { PaymentRecord } from '../../src/types.js'

function makeRecord(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: 'pay-001',
    checkoutRequestId: 'ws_CO_001',
    merchantRequestId: 'merch-001',
    phoneNumber: '254712345678',
    amount: 1500,
    accountReference: 'INV-101',
    status: 'PENDING',
    initiatedAt: new Date('2026-10-26T07:00:00Z'),
    ...overrides,
  }
}

describe('SqliteAdapter', () => {
  let adapter: SqliteAdapter

  beforeEach(() => {
    // In-memory SQLite for isolated test execution
    adapter = new SqliteAdapter(':memory:')
  })

  afterEach(() => {
    adapter.close()
  })

  it('creates and retrieves a payment by id', async () => {
    const record = makeRecord()
    await adapter.createPayment(record)
    const found = await adapter.getPayment('pay-001')
    expect(found).not.toBeNull()
    expect(found?.id).toBe('pay-001')
    expect(found?.amount).toBe(1500)
    expect(found?.status).toBe('PENDING')
    expect(found?.initiatedAt.toISOString()).toBe('2026-10-26T07:00:00.000Z')
  })

  it('returns null for missing id', async () => {
    expect(await adapter.getPayment('does-not-exist')).toBeNull()
  })

  it('finds by checkoutRequestId', async () => {
    await adapter.createPayment(makeRecord())
    const found = await adapter.getPaymentByCheckoutId('ws_CO_001')
    expect(found?.id).toBe('pay-001')
  })

  it('finds by idempotency key when provided at creation', async () => {
    await adapter.createPayment(makeRecord(), 'idem-key-abc')
    const found = await adapter.getPaymentByIdempotencyKey('idem-key-abc')
    expect(found?.id).toBe('pay-001')
  })

  it('registers idempotency key after creation', async () => {
    await adapter.createPayment(makeRecord())
    await adapter.registerIdempotencyKey('idem-key-delayed', 'pay-001')
    const found = await adapter.getPaymentByIdempotencyKey('idem-key-delayed')
    expect(found?.id).toBe('pay-001')
  })

  it('updates a payment with partial fields', async () => {
    await adapter.createPayment(makeRecord())
    await adapter.updatePayment('pay-001', {
      status: 'SUCCESS',
      mpesaReceiptNumber: 'QJD82KL9',
      completedAt: new Date('2026-10-26T07:00:02Z'),
      customerName: 'KARIUKI MWANGI',
    })
    const updated = await adapter.getPayment('pay-001')
    expect(updated?.status).toBe('SUCCESS')
    expect(updated?.mpesaReceiptNumber).toBe('QJD82KL9')
    expect(updated?.customerName).toBe('KARIUKI MWANGI')
    expect(updated?.completedAt?.toISOString()).toBe('2026-10-26T07:00:02.000Z')
  })

  it('atomically settles a PENDING payment and rejects duplicate settlement', async () => {
    await adapter.createPayment(makeRecord())

    // First settlement wins (compare-and-swap succeeds)
    const firstAttempt = await adapter.settlePayment('pay-001', {
      status: 'SUCCESS',
      mpesaReceiptNumber: 'QJD82KL9',
      resultCode: 0,
      completedAt: new Date('2026-10-26T07:00:01Z'),
    })
    expect(firstAttempt).toBe(true)

    // Second racing settlement attempt fails (status is no longer PENDING)
    const secondAttempt = await adapter.settlePayment('pay-001', {
      status: 'SUCCESS',
      mpesaReceiptNumber: 'QJD82KL9',
      resultCode: 0,
      completedAt: new Date('2026-10-26T07:00:01Z'),
    })
    expect(secondAttempt).toBe(false)
  })

  it('filters payments by status and date range for reconciliation', async () => {
    await adapter.createPayment(makeRecord({
      id: 'pay-1',
      checkoutRequestId: 'ws_1',
      status: 'SUCCESS',
      initiatedAt: new Date('2026-10-26T08:00:00Z'),
    }))
    await adapter.createPayment(makeRecord({
      id: 'pay-2',
      checkoutRequestId: 'ws_2',
      status: 'FAILED',
      initiatedAt: new Date('2026-10-26T08:30:00Z'),
    }))
    await adapter.createPayment(makeRecord({
      id: 'pay-3',
      checkoutRequestId: 'ws_3',
      status: 'SUCCESS',
      initiatedAt: new Date('2026-10-26T12:00:00Z'),
    }))

    const results = await adapter.getPaymentsByStatusAndDateRange(
      ['SUCCESS'],
      new Date('2026-10-26T07:00:00Z'),
      new Date('2026-10-26T10:00:00Z')
    )

    expect(results).toHaveLength(1)
    expect(results[0]?.id).toBe('pay-1')
  })

  it('searches recent payments for cashier message store', async () => {
    await adapter.createPayment(makeRecord({
      id: 'pay-search-1',
      checkoutRequestId: 'ws_search_1',
      mpesaReceiptNumber: 'QJD82KL9',
      phoneNumber: '254712345678',
      customerName: 'JOHN DOE',
      status: 'SUCCESS',
    }))
    await adapter.createPayment(makeRecord({
      id: 'pay-search-2',
      checkoutRequestId: 'ws_search_2',
      mpesaReceiptNumber: 'RTE4477M',
      phoneNumber: '254722998877',
      customerName: 'MARY WANJIKU',
      status: 'SUCCESS',
    }))

    // Search by receipt code suffix
    const byReceipt = await adapter.getRecentPayments({ search: 'KL9' })
    expect(byReceipt).toHaveLength(1)
    expect(byReceipt[0]?.id).toBe('pay-search-1')

    // Search by customer name
    const byName = await adapter.getRecentPayments({ search: 'WANJIKU' })
    expect(byName).toHaveLength(1)
    expect(byName[0]?.id).toBe('pay-search-2')

    // Search by phone
    const byPhone = await adapter.getRecentPayments({ search: '998877' })
    expect(byPhone).toHaveLength(1)
    expect(byPhone[0]?.id).toBe('pay-search-2')
  })
})
