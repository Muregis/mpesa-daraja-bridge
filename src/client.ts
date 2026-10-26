import { randomUUID } from 'crypto'
import type {
  MpesaConfig,
  InitiatePaymentParams,
  InitiatePaymentResult,
  CallbackProcessResult,
  ReconciliationResult,
  PaymentStatus,
  PaymentRecord,
  Logger,
} from './types.js'
import type { StorageAdapter } from './adapters/types.js'
import { normalisePhoneNumber, initiateStkPush } from './initiate.js'
import { processCallback as _processCallback } from './callback.js'
import { pollPaymentStatus as _pollPaymentStatus } from './poll.js'
import { reconcile as _reconcile } from './reconcile.js'
import {
  processC2BConfirmation as _processC2BConfirmation,
  processC2BValidation as _processC2BValidation,
  type C2BCallbackPayload,
  type C2BProcessResult,
  type C2BValidationResponse,
} from './c2b.js'

export class MpesaStk {
  private readonly config: Required<
    Pick<MpesaConfig, 'timeoutMs' | 'pollIntervalMs' | 'maxPollAttempts'>
  > &
    MpesaConfig

  private settledHandlers: Array<(payment: PaymentRecord) => void | Promise<void>> = []

  // In-process guard: concurrent initiations with the same idempotency key share
  // ONE in-flight Daraja call. A second caller awaits the first caller's promise
  // instead of issuing its own STK Push — so a double-tapped "Pay" button or a
  // retried HTTP request charges the customer exactly once. Cross-process
  // duplicates are still caught by the idempotency_key UNIQUE DB constraint.
  private readonly inFlightInitiations = new Map<string, Promise<InitiatePaymentResult>>()

  constructor(
    config: MpesaConfig,
    private readonly storage: StorageAdapter,
    private readonly logger?: Logger
  ) {
    this.config = {
      timeoutMs: 75000,
      pollIntervalMs: 5000,
      maxPollAttempts: 10,
      ...config,
    }
  }

  onPaymentSettled(handler: (payment: PaymentRecord) => void | Promise<void>): void {
    this.settledHandlers.push(handler)
  }

  private async notifySettled(payment: PaymentRecord): Promise<void> {
    for (const handler of this.settledHandlers) {
      try {
        await handler(payment)
      } catch (err) {
        this.logger?.error('onPaymentSettled handler threw an error', {
          paymentId: payment.id,
          error: String(err),
        })
      }
    }
  }

  async initiatePayment(params: InitiatePaymentParams): Promise<InitiatePaymentResult> {
    const normalisedPhone = normalisePhoneNumber(params.phoneNumber)

    if (!params.idempotencyKey) {
      return this.executeInitiation(params, normalisedPhone)
    }

    const key = params.idempotencyKey

    // Already completed by an earlier request (this process or another)?
    const existing = await this.storage.getPaymentByIdempotencyKey(key)
    if (existing) {
      this.logger?.info('Idempotent re-request: returning existing payment', {
        idempotencyKey: key,
        paymentId: existing.id,
      })
      return {
        checkoutRequestId: existing.checkoutRequestId,
        merchantRequestId: existing.merchantRequestId,
        paymentId: existing.id,
      }
    }

    // Another initiation for this key is in flight right now — await it instead
    // of starting a second STK Push. The path from this get() to the set() below
    // is synchronous, so two racers can never both miss and both proceed.
    const inFlight = this.inFlightInitiations.get(key)
    if (inFlight) {
      this.logger?.info('Idempotent re-request (in-flight collision): awaiting first initiation', {
        idempotencyKey: key,
      })
      return inFlight
    }

    const promise = this.executeInitiation(params, normalisedPhone)
    this.inFlightInitiations.set(key, promise)
    try {
      return await promise
    } finally {
      this.inFlightInitiations.delete(key)
    }
  }

  private async executeInitiation(
    params: InitiatePaymentParams,
    normalisedPhone: string
  ): Promise<InitiatePaymentResult> {
    const { merchantRequestId, checkoutRequestId } = await initiateStkPush(
      this.config,
      { ...params, normalisedPhone },
      this.logger
    )

    const paymentId = randomUUID()
    const record: PaymentRecord = {
      id: paymentId,
      checkoutRequestId,
      merchantRequestId,
      phoneNumber: normalisedPhone,
      amount: params.amount,
      accountReference: params.accountReference,
      status: 'PENDING',
      initiatedAt: new Date(),
    }

    // Key is passed directly to createPayment so it is stored in the same
    // atomic operation as the record — no crash window between two calls.
    await this.storage.createPayment(record, params.idempotencyKey)

    return { checkoutRequestId, merchantRequestId, paymentId }
  }

  /**
   * Call this from your webhook route handler.
   * Always respond to Safaricom with `{ ResultCode: 0, ResultDesc: "Success" }`
   * immediately after this returns — Safaricom requires a 200 within 5 seconds.
   *
   * onPaymentSettled handlers are fired asynchronously after this method resolves
   * (fire-and-forget). They do NOT block the HTTP response. If you need to
   * guarantee handler completion before responding, call notifySettled yourself.
   */
  async processCallback(body: unknown): Promise<CallbackProcessResult> {
    const result = await _processCallback(body, this.storage, this.logger)

    // Only fire settled handlers for non-duplicate, terminal-status callbacks
    if (!result.isDuplicate && result.status !== 'PENDING') {
      const payment = await this.storage.getPayment(result.paymentId)
      if (payment) {
        // Fire-and-forget — the route handler should not await this
        void this.notifySettled(payment)
      }
    }

    return result
  }

  /**
   * Process Safaricom C2B Confirmation webhook (Buy Goods Till or Paybill).
   *
   * Persists incoming payment, deduplicates against already-received transactions,
   * and fires onPaymentSettled asynchronously so connected cashiers see the
   * payment immediately.
   */
  async processC2BConfirmation(body: unknown): Promise<C2BProcessResult> {
    const result = await _processC2BConfirmation(body, this.storage, this.logger)

    if (!result.isDuplicate) {
      void this.notifySettled(result.record)
    }

    return result
  }

  /**
   * Validate Safaricom C2B Validation webhook before completing a customer payment.
   * Return 0 to accept or a C2B rejection code to decline.
   */
  processC2BValidation(
    body: unknown,
    validator?: (payload: C2BCallbackPayload) => boolean | { valid: boolean; reason?: string }
  ): C2BValidationResponse {
    return _processC2BValidation(body, validator)
  }

  async pollPaymentStatus(checkoutRequestId: string): Promise<PaymentStatus> {
    return _pollPaymentStatus(
      checkoutRequestId,
      this.config,
      this.storage,
      async (payment) => {
        await this.notifySettled(payment)
      },
      this.logger
    )
  }

  async reconcile(from: Date, to: Date): Promise<ReconciliationResult> {
    return _reconcile(from, to, this.config, this.storage, this.logger)
  }
}
