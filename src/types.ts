export type Environment = 'sandbox' | 'production'

export type PaymentStatus =
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'EXPIRED'

export interface MpesaConfig {
  consumerKey: string
  consumerSecret: string
  shortCode: string
  passKey: string
  callbackUrl: string
  environment: Environment
  /** default 75000 (75s — M-Pesa's own timeout is 60s) */
  timeoutMs?: number
  /**
   * Base interval (ms) for the poll fallback, default 5000. The poll waits one
   * interval before its first STK Query, then applies a Fibonacci backoff
   * (×1, 2, 3, 5, 8, 13, 21) capped at 30s — e.g. 5s → 10s → 15s → 25s → 30s.
   */
  pollIntervalMs?: number
  /** default 10 */
  maxPollAttempts?: number
  /**
   * Politeness floor in ms between STK Query calls during reconciliation
   * (default 100). The STK Query endpoint is rate-limited by an Apigee
   * SpikeArrest policy; on HTTP 429 reconciliation additionally backs off
   * adaptively (honouring Retry-After), so this is a floor, not the sole guard.
   */
  reconcileQueryIntervalMs?: number
}

export interface PaymentRecord {
  id: string                      // your internal ID
  checkoutRequestId: string       // from Daraja
  merchantRequestId: string       // from Daraja
  phoneNumber: string
  amount: number
  accountReference: string
  status: PaymentStatus
  mpesaReceiptNumber?: string
  failureReason?: string
  resultCode?: number
  initiatedAt: Date
  completedAt?: Date
  rawCallback?: unknown           // store the full callback for audit
  customerName?: string           // customer full name (useful in C2B & retail receipts)
  paymentType?: 'STK_PUSH' | 'C2B' // payment origin type
  businessShortCode?: string      // Till or Paybill number
}

export interface InitiatePaymentParams {
  /** accepts 07xx, 01xx, +2547xx, +2541xx, 2547xx, 2541xx — normalised internally to 254xxxxxxxxx */
  phoneNumber: string
  /** must be a positive integer */
  amount: number
  accountReference: string
  description: string
  /** if provided, return existing record if already initiated */
  idempotencyKey?: string
}

export interface InitiatePaymentResult {
  checkoutRequestId: string
  merchantRequestId: string
  paymentId: string
}

export interface CallbackProcessResult {
  paymentId: string
  status: PaymentStatus
  isDuplicate: boolean
  receipt?: string
}

export interface ReconciliationResult {
  /**
   * Number of payments successfully queried against Daraja.
   * Does NOT include payments that were skipped due to a Daraja API error.
   * See `skipped` for the count of payments that could not be verified.
   */
  checked: number
  matched: number
  /**
   * Number of payments skipped because the Daraja STK Query API returned an
   * error for that payment. Skipped payments are not counted in `checked`.
   *
   * If `skipped > 0`, re-run reconciliation for the affected time window after
   * the Daraja API recovers. Skipped payments are logged at the ERROR level.
   */
  skipped: number
  mismatches: ReconciliationMismatch[]
}

export interface ReconciliationMismatch {
  paymentId: string
  checkoutRequestId: string
  storedStatus: PaymentStatus
  mpesaStatus: PaymentStatus
  amount: number
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
  error(msg: string, meta?: Record<string, unknown>): void
}

// ---------------------------------------------------------------------------
// Internal Daraja API shapes — not exported as public API surface
// ---------------------------------------------------------------------------

export interface DarajaTokenResponse {
  access_token: string
  expires_in: string
}

export interface DarajaStkPushRequest {
  BusinessShortCode: string
  Password: string
  Timestamp: string
  TransactionType: 'CustomerPayBillOnline'
  Amount: number
  PartyA: string
  PartyB: string
  PhoneNumber: string
  CallBackURL: string
  AccountReference: string
  TransactionDesc: string
}

export interface DarajaStkPushSuccess {
  MerchantRequestID: string
  CheckoutRequestID: string
  ResponseCode: string
  ResponseDescription: string
  CustomerMessage: string
}

export interface DarajaStkPushError {
  requestId: string
  errorCode: string
  errorMessage: string
}

export interface DarajaQueryRequest {
  BusinessShortCode: string
  Password: string
  Timestamp: string
  CheckoutRequestID: string
}

export interface DarajaQueryResponse {
  ResponseCode: string
  ResponseDescription: string
  MerchantRequestID: string
  CheckoutRequestID: string
  ResultCode: string
  ResultDesc: string
}

// Callback shapes — PhoneNumber may be masked or absent in 2026+
export interface MpesaCallbackMetadataItem {
  Name: string
  Value?: string | number
}

export interface MpesaCallbackMetadata {
  Item: MpesaCallbackMetadataItem[]
}

export interface MpesaStkCallbackSuccess {
  MerchantRequestID: string
  CheckoutRequestID: string
  ResultCode: 0
  ResultDesc: string
  CallbackMetadata: MpesaCallbackMetadata
}

export interface MpesaStkCallbackFailure {
  MerchantRequestID: string
  CheckoutRequestID: string
  ResultCode: number
  ResultDesc: string
}

export type MpesaStkCallback = MpesaStkCallbackSuccess | MpesaStkCallbackFailure

export interface MpesaCallbackBody {
  Body: {
    stkCallback: MpesaStkCallback
  }
}
