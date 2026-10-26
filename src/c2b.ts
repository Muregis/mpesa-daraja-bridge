import type { PaymentRecord, Logger } from './types.js'
import type { StorageAdapter } from './adapters/types.js'
import { normalisePhoneNumber } from './initiate.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface C2BCallbackPayload {
  TransactionType?: string
  TransID: string
  TransTime: string
  TransAmount: string | number
  BusinessShortCode: string | number
  BillRefNumber?: string
  InvoiceNumber?: string
  OrgAccountBalance?: string
  ThirdPartyTransID?: string
  MSISDN: string | number
  FirstName?: string
  MiddleName?: string
  LastName?: string
}

export interface C2BProcessResult {
  paymentId: string
  receipt: string
  amount: number
  phoneNumber: string
  customerName: string
  status: 'SUCCESS'
  isDuplicate: boolean
  record: PaymentRecord
}

export interface C2BValidationResponse {
  ResultCode: 0 | string
  ResultDesc: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse Daraja C2B TransTime (e.g., '20261026074512' -> YYYYMMDDHHmmss) into a Date.
 */
export function parseTransTime(transTime?: string): Date {
  if (transTime && /^\d{14}$/.test(transTime)) {
    const year = parseInt(transTime.substring(0, 4), 10)
    const month = parseInt(transTime.substring(4, 6), 10) - 1
    const day = parseInt(transTime.substring(6, 8), 10)
    const hour = parseInt(transTime.substring(8, 10), 10)
    const minute = parseInt(transTime.substring(10, 12), 10)
    const second = parseInt(transTime.substring(12, 14), 10)
    return new Date(Date.UTC(year, month, day, hour, minute, second))
  }
  return new Date()
}

/**
 * Format customer name from FirstName, MiddleName, and LastName.
 */
export function formatCustomerName(
  firstName?: string,
  middleName?: string,
  lastName?: string
): string {
  const parts = [firstName, middleName, lastName]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p && p.length > 0))
  return parts.join(' ') || 'Customer'
}

/**
 * Validate that an incoming object matches the C2B Confirmation/Validation structure.
 */
export function validateC2BPayload(body: unknown): body is C2BCallbackPayload {
  if (typeof body !== 'object' || body === null) return false
  const p = body as Record<string, unknown>
  return (
    typeof p['TransID'] === 'string' &&
    p['TransID'].trim().length > 0 &&
    (typeof p['TransAmount'] === 'string' || typeof p['TransAmount'] === 'number') &&
    (typeof p['MSISDN'] === 'string' || typeof p['MSISDN'] === 'number') &&
    (typeof p['BusinessShortCode'] === 'string' || typeof p['BusinessShortCode'] === 'number')
  )
}

// ---------------------------------------------------------------------------
// Processing Logic
// ---------------------------------------------------------------------------

/**
 * Process a confirmed C2B payment (Buy Goods Till or Paybill).
 *
 * Ingests the transaction, normalises customer details, prevents duplicate
 * insertion, and persists it immediately in SUCCESS status.
 */
export async function processC2BConfirmation(
  body: unknown,
  storage: StorageAdapter,
  logger?: Logger
): Promise<C2BProcessResult> {
  if (!validateC2BPayload(body)) {
    throw new Error(
      'Invalid C2B callback payload: missing required fields (TransID, TransAmount, MSISDN, BusinessShortCode)'
    )
  }

  const payload = body as C2BCallbackPayload
  const receipt = payload.TransID.trim().toUpperCase()
  const checkoutRequestId = `C2B_${receipt}`
  const paymentId = `c2b_${receipt}`

  logger?.info('Processing incoming C2B payment', {
    receipt,
    amount: payload.TransAmount,
    phone: payload.MSISDN,
    shortCode: payload.BusinessShortCode,
  })

  // 1. Deduplication check: check if receipt already exists in store
  const existingByReceipt = storage.getPaymentByReceiptNumber
    ? await storage.getPaymentByReceiptNumber(receipt)
    : await storage.getPaymentByCheckoutId(checkoutRequestId)

  if (existingByReceipt) {
    logger?.warn('Duplicate C2B callback received — ignoring', {
      paymentId: existingByReceipt.id,
      receipt,
    })
    return {
      paymentId: existingByReceipt.id,
      receipt,
      amount: existingByReceipt.amount,
      phoneNumber: existingByReceipt.phoneNumber,
      customerName: existingByReceipt.customerName ?? 'Customer',
      status: 'SUCCESS',
      isDuplicate: true,
      record: existingByReceipt,
    }
  }

  // 2. Parse & normalize amount
  const rawAmount = typeof payload.TransAmount === 'number'
    ? payload.TransAmount
    : parseFloat(payload.TransAmount)

  if (isNaN(rawAmount) || rawAmount <= 0) {
    throw new Error(`Invalid C2B TransAmount "${payload.TransAmount}": must be a positive number`)
  }
  const amount = Math.round(rawAmount)

  // 3. Normalise phone number
  let phoneNumber: string
  try {
    phoneNumber = normalisePhoneNumber(String(payload.MSISDN))
  } catch {
    phoneNumber = String(payload.MSISDN).replace(/\D/g, '')
  }

  // 4. Construct customer name and timestamps
  const customerName = formatCustomerName(payload.FirstName, payload.MiddleName, payload.LastName)
  const transDate = parseTransTime(payload.TransTime)
  const accountReference = payload.BillRefNumber?.trim() || receipt
  const shortCode = String(payload.BusinessShortCode)

  const record: PaymentRecord = {
    id: paymentId,
    checkoutRequestId,
    merchantRequestId: shortCode,
    phoneNumber,
    amount,
    accountReference,
    status: 'SUCCESS',
    mpesaReceiptNumber: receipt,
    initiatedAt: transDate,
    completedAt: transDate,
    customerName,
    paymentType: 'C2B',
    businessShortCode: shortCode,
    rawCallback: body,
  }

  // 5. Atomic persistence: C2B payments arrive already settled
  await storage.createPayment(record)

  logger?.info('C2B payment confirmed and recorded', {
    paymentId,
    receipt,
    amount,
    customerName,
  })

  return {
    paymentId,
    receipt,
    amount,
    phoneNumber,
    customerName,
    status: 'SUCCESS',
    isDuplicate: false,
    record,
  }
}

/**
 * Handle Daraja C2B Validation request.
 * Safaricom calls ValidationURL before completing the transaction if validation is enabled.
 */
export function processC2BValidation(
  body: unknown,
  validator?: (payload: C2BCallbackPayload) => boolean | { valid: boolean; reason?: string }
): C2BValidationResponse {
  if (!validateC2BPayload(body)) {
    return {
      ResultCode: 'C2B00011',
      ResultDesc: 'Rejected: Invalid request structure',
    }
  }

  if (validator) {
    const outcome = validator(body)
    if (typeof outcome === 'boolean' && !outcome) {
      return {
        ResultCode: 'C2B00012',
        ResultDesc: 'Rejected: Bill reference or account not found',
      }
    }
    if (typeof outcome === 'object' && !outcome.valid) {
      return {
        ResultCode: 'C2B00012',
        ResultDesc: outcome.reason || 'Rejected: Validation check failed',
      }
    }
  }

  return {
    ResultCode: 0,
    ResultDesc: 'Accepted',
  }
}
