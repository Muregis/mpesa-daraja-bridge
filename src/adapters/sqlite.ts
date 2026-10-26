import DatabaseConstructor, { type Database as BetterSqlite3Database } from 'better-sqlite3'
import type { PaymentRecord, PaymentStatus } from '../types.js'
import type { StorageAdapter } from './types.js'

// ---------------------------------------------------------------------------
// Row ↔ domain mapping
// ---------------------------------------------------------------------------

interface PaymentRow {
  id: string
  checkout_request_id: string
  merchant_request_id: string
  phone_number: string
  amount: number
  account_reference: string
  status: string
  mpesa_receipt_number: string | null
  failure_reason: string | null
  result_code: number | null
  initiated_at: string
  completed_at: string | null
  raw_callback: string | null
  idempotency_key: string | null
  customer_name: string | null
  payment_type: string | null
  business_short_code: string | null
}

const VALID_STATUSES = new Set<string>([
  'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT', 'EXPIRED',
])

function rowToRecord(row: PaymentRow): PaymentRecord {
  if (!VALID_STATUSES.has(row.status)) {
    throw new Error(
      `Unknown payment status "${row.status}" for payment id "${row.id}". ` +
      'This indicates a database inconsistency — check for manual edits or failed migrations.'
    )
  }

  const record: PaymentRecord = {
    id: row.id,
    checkoutRequestId: row.checkout_request_id,
    merchantRequestId: row.merchant_request_id,
    phoneNumber: row.phone_number,
    amount: row.amount,
    accountReference: row.account_reference,
    status: row.status as PaymentStatus,
    initiatedAt: new Date(row.initiated_at),
  }

  if (row.mpesa_receipt_number !== null) record.mpesaReceiptNumber = row.mpesa_receipt_number
  if (row.failure_reason !== null) record.failureReason = row.failure_reason
  if (row.result_code !== null) record.resultCode = row.result_code
  if (row.completed_at !== null) record.completedAt = new Date(row.completed_at)
  if (row.raw_callback !== null) {
    try {
      record.rawCallback = JSON.parse(row.raw_callback)
    } catch {
      record.rawCallback = row.raw_callback
    }
  }
  if (row.customer_name !== null) record.customerName = row.customer_name
  if (row.payment_type !== null) record.paymentType = row.payment_type as 'STK_PUSH' | 'C2B'
  if (row.business_short_code !== null) record.businessShortCode = row.business_short_code

  return record
}

// ---------------------------------------------------------------------------
// Column Mapping
// ---------------------------------------------------------------------------

const PAYMENT_COLUMN_MAP: Partial<Record<keyof PaymentRecord, string>> = {
  status: 'status',
  mpesaReceiptNumber: 'mpesa_receipt_number',
  failureReason: 'failure_reason',
  resultCode: 'result_code',
  completedAt: 'completed_at',
  rawCallback: 'raw_callback',
  merchantRequestId: 'merchant_request_id',
  phoneNumber: 'phone_number',
  amount: 'amount',
  accountReference: 'account_reference',
  customerName: 'customer_name',
  paymentType: 'payment_type',
  businessShortCode: 'business_short_code',
}

function formatValue(key: keyof PaymentRecord, value: unknown): unknown {
  if (value === undefined || value === null) return null
  if (value instanceof Date) return value.toISOString()
  if (key === 'rawCallback') return JSON.stringify(value)
  return value
}

// ---------------------------------------------------------------------------
// SqliteAdapter
// ---------------------------------------------------------------------------

export class SqliteAdapter implements StorageAdapter {
  private readonly db: BetterSqlite3Database
  private readonly ownsDb: boolean

  /**
   * @param dbOrPath - A better-sqlite3 Database instance or a file path string.
   * Defaults to 'mpesa.db'. Use ':memory:' for transient in-memory storage.
   */
  constructor(dbOrPath?: BetterSqlite3Database | string) {
    if (typeof dbOrPath === 'string' || dbOrPath === undefined) {
      const path = dbOrPath ?? 'mpesa.db'
      this.db = new DatabaseConstructor(path)
      this.ownsDb = true
      if (path !== ':memory:') {
        this.db.pragma('journal_mode = WAL')
      }
    } else {
      this.db = dbOrPath
      this.ownsDb = false
    }

    this.migrateSync()
  }

  /**
   * Synchronous table and index initialization. Safe on startup.
   */
  private migrateSync(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mpesa_payments (
        id                   TEXT PRIMARY KEY,
        checkout_request_id  TEXT UNIQUE NOT NULL,
        merchant_request_id  TEXT NOT NULL,
        phone_number         TEXT NOT NULL,
        amount               INTEGER NOT NULL,
        account_reference    TEXT NOT NULL,
        status               TEXT NOT NULL DEFAULT 'PENDING'
                               CHECK (status IN ('PENDING','SUCCESS','FAILED','CANCELLED','TIMEOUT','EXPIRED')),
        mpesa_receipt_number TEXT,
        failure_reason       TEXT,
        result_code          INTEGER,
        initiated_at         TEXT NOT NULL,
        completed_at         TEXT,
        raw_callback         TEXT,
        idempotency_key      TEXT UNIQUE,
        customer_name        TEXT,
        payment_type         TEXT DEFAULT 'STK_PUSH',
        business_short_code  TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_mpesa_payments_status_initiated
        ON mpesa_payments(status, initiated_at);

      CREATE INDEX IF NOT EXISTS idx_mpesa_payments_receipt
        ON mpesa_payments(mpesa_receipt_number);

      CREATE INDEX IF NOT EXISTS idx_mpesa_payments_phone
        ON mpesa_payments(phone_number);
    `)
  }

  async migrate(): Promise<void> {
    this.migrateSync()
  }

  async createPayment(record: PaymentRecord, idempotencyKey?: string): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO mpesa_payments (
        id, checkout_request_id, merchant_request_id,
        phone_number, amount, account_reference,
        status, mpesa_receipt_number, failure_reason, result_code,
        initiated_at, completed_at, raw_callback, idempotency_key,
        customer_name, payment_type, business_short_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      record.id,
      record.checkoutRequestId,
      record.merchantRequestId,
      record.phoneNumber,
      record.amount,
      record.accountReference,
      record.status,
      record.mpesaReceiptNumber ?? null,
      record.failureReason ?? null,
      record.resultCode ?? null,
      record.initiatedAt.toISOString(),
      record.completedAt ? record.completedAt.toISOString() : null,
      record.rawCallback !== undefined ? JSON.stringify(record.rawCallback) : null,
      idempotencyKey ?? null,
      record.customerName ?? null,
      record.paymentType ?? 'STK_PUSH',
      record.businessShortCode ?? null
    )
  }

  async getPayment(id: string): Promise<PaymentRecord | null> {
    const stmt = this.db.prepare('SELECT * FROM mpesa_payments WHERE id = ? LIMIT 1')
    const row = stmt.get(id) as PaymentRow | undefined
    return row ? rowToRecord(row) : null
  }

  async getPaymentByCheckoutId(checkoutRequestId: string): Promise<PaymentRecord | null> {
    const stmt = this.db.prepare('SELECT * FROM mpesa_payments WHERE checkout_request_id = ? LIMIT 1')
    const row = stmt.get(checkoutRequestId) as PaymentRow | undefined
    return row ? rowToRecord(row) : null
  }

  async getPaymentByIdempotencyKey(key: string): Promise<PaymentRecord | null> {
    const stmt = this.db.prepare('SELECT * FROM mpesa_payments WHERE idempotency_key = ? LIMIT 1')
    const row = stmt.get(key) as PaymentRow | undefined
    return row ? rowToRecord(row) : null
  }

  async getPaymentByReceiptNumber(receiptNumber: string): Promise<PaymentRecord | null> {
    const stmt = this.db.prepare('SELECT * FROM mpesa_payments WHERE mpesa_receipt_number = ? LIMIT 1')
    const row = stmt.get(receiptNumber) as PaymentRow | undefined
    return row ? rowToRecord(row) : null
  }

  async updatePayment(id: string, updates: Partial<PaymentRecord>): Promise<void> {
    const setClauses: string[] = []
    const values: unknown[] = []

    for (const [key, column] of Object.entries(PAYMENT_COLUMN_MAP)) {
      const prop = key as keyof PaymentRecord
      if (!(prop in updates)) continue
      setClauses.push(`${column} = ?`)
      values.push(formatValue(prop, updates[prop]))
    }

    if (setClauses.length === 0) return

    values.push(id)
    const sql = `UPDATE mpesa_payments SET ${setClauses.join(', ')} WHERE id = ?`
    this.db.prepare(sql).run(...values)
  }

  /**
   * Atomically transition a PENDING payment to a terminal state (compare-and-swap).
   */
  async settlePayment(id: string, updates: Partial<PaymentRecord>): Promise<boolean> {
    const settlementKeys: Array<keyof PaymentRecord> = [
      'status', 'mpesaReceiptNumber', 'failureReason', 'resultCode', 'completedAt', 'rawCallback', 'customerName',
    ]

    const setClauses: string[] = []
    const values: unknown[] = []

    for (const key of settlementKeys) {
      if (!(key in updates)) continue
      const column = PAYMENT_COLUMN_MAP[key]
      if (!column) continue
      setClauses.push(`${column} = ?`)
      values.push(formatValue(key, updates[key]))
    }

    if (setClauses.length === 0) return false

    values.push(id)
    const sql = `UPDATE mpesa_payments SET ${setClauses.join(', ')} WHERE id = ? AND status = 'PENDING'`
    const result = this.db.prepare(sql).run(...values)
    return result.changes > 0
  }

  async registerIdempotencyKey(key: string, paymentId: string): Promise<void> {
    const stmt = this.db.prepare('UPDATE mpesa_payments SET idempotency_key = ? WHERE id = ?')
    stmt.run(key, paymentId)
  }

  async getPaymentsByStatusAndDateRange(
    statuses: PaymentStatus[],
    from: Date,
    to: Date
  ): Promise<PaymentRecord[]> {
    if (statuses.length === 0) return []
    const placeholders = statuses.map(() => '?').join(', ')
    const sql = `
      SELECT * FROM mpesa_payments
      WHERE status IN (${placeholders})
        AND initiated_at >= ?
        AND initiated_at <= ?
      ORDER BY initiated_at ASC
    `
    const params = [
      ...statuses,
      from.toISOString(),
      to.toISOString(),
    ]
    const rows = this.db.prepare(sql).all(...params) as PaymentRow[]
    return rows.map(rowToRecord)
  }

  /**
   * Retail / POS Message Store Query:
   * Returns recent transactions with search across receipt number, phone, customer name, and bill ref.
   */
  async getRecentPayments(options?: {
    limit?: number
    offset?: number
    search?: string
  }): Promise<PaymentRecord[]> {
    const limit = Math.min(options?.limit ?? 50, 200)
    const offset = options?.offset ?? 0
    const search = options?.search?.trim()

    if (search) {
      const pattern = `%${search}%`
      const sql = `
        SELECT * FROM mpesa_payments
        WHERE mpesa_receipt_number LIKE ?
           OR phone_number LIKE ?
           OR customer_name LIKE ?
           OR account_reference LIKE ?
        ORDER BY initiated_at DESC
        LIMIT ? OFFSET ?
      `
      const rows = this.db.prepare(sql).all(pattern, pattern, pattern, pattern, limit, offset) as PaymentRow[]
      return rows.map(rowToRecord)
    }

    const sql = `
      SELECT * FROM mpesa_payments
      ORDER BY initiated_at DESC
      LIMIT ? OFFSET ?
    `
    const rows = this.db.prepare(sql).all(limit, offset) as PaymentRow[]
    return rows.map(rowToRecord)
  }

  /**
   * Cleanly closes the SQLite database connection.
   */
  close(): void {
    if (this.ownsDb && this.db.open) {
      this.db.close()
    }
  }
}
