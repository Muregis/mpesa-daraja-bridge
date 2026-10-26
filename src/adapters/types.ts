import type { PaymentRecord, PaymentStatus } from '../types.js'

export interface StorageAdapter {
  /**
   * Create a new payment record in PENDING state.
   *
   * If `idempotencyKey` is provided, it is registered atomically with the
   * record in the same operation — eliminating the race window that exists
   * when `createPayment` and `registerIdempotencyKey` are called separately.
   */
  createPayment(record: PaymentRecord, idempotencyKey?: string): Promise<void>

  /** Find by your internal ID */
  getPayment(id: string): Promise<PaymentRecord | null>

  /** Find by M-Pesa's CheckoutRequestID */
  getPaymentByCheckoutId(checkoutRequestId: string): Promise<PaymentRecord | null>

  /**
   * Find by idempotency key.
   * Implementations must store the mapping idempotencyKey → paymentId separately
   * (or as a column) so this lookup is O(1).
   */
  getPaymentByIdempotencyKey(key: string): Promise<PaymentRecord | null>

  /** Update status and/or any other fields on a payment */
  updatePayment(id: string, updates: Partial<PaymentRecord>): Promise<void>

  /**
   * Atomically transition a payment from PENDING to a terminal status.
   *
   * Returns `true` if the update succeeded (the payment was PENDING and is now
   * updated), or `false` if the payment was already in a non-PENDING state
   * (duplicate callback/race condition).
   *
   * Implementations MUST make this transition atomic (compare-and-swap) to
   * prevent double-processing when M-Pesa fires the same callback twice within
   * milliseconds. This is the primary deduplication guard.
   */
  settlePayment(
    id: string,
    updates: Partial<PaymentRecord>
  ): Promise<boolean>

  /**
   * Attach an idempotency key to an existing payment record.
   * Called by MpesaStk after a successful STK Push initiation.
   * Implementations that store the key at creation time may make this a no-op.
   */
  registerIdempotencyKey(key: string, paymentId: string): Promise<void>

  /**
   * For reconciliation: get all payments whose status is in `statuses` and whose
   * `initiatedAt` falls within [from, to].
   *
   * Pass all statuses you want to verify in one call — implementations can
   * translate this to a single `WHERE status = ANY(...)` query rather than
   * issuing one query per status.
   */
  getPaymentsByStatusAndDateRange(
    statuses: PaymentStatus[],
    from: Date,
    to: Date
  ): Promise<PaymentRecord[]>

  /**
   * Optional POS convenience: Find by M-Pesa receipt number (e.g. QJD82KL9).
   */
  getPaymentByReceiptNumber?(receiptNumber: string): Promise<PaymentRecord | null>

  /**
   * Optional POS convenience: Retrieve recent payments with optional search query
   * for the cashier live feed / message store.
   */
  getRecentPayments?(options?: {
    limit?: number
    offset?: number
    search?: string | undefined
  }): Promise<PaymentRecord[]>
}
