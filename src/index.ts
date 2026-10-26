// Public API — only export what users need to interact with the library

export { MpesaStk } from './client.js'

// Types
export type {
  Environment,
  PaymentStatus,
  MpesaConfig,
  PaymentRecord,
  InitiatePaymentParams,
  InitiatePaymentResult,
  CallbackProcessResult,
  ReconciliationResult,
  ReconciliationMismatch,
  Logger,
} from './types.js'

// Adapter interface (so users can implement their own)
export type { StorageAdapter } from './adapters/types.js'

// Bundled adapters
export { MemoryAdapter } from './adapters/memory.js'
export { PostgresAdapter } from './adapters/postgres.js'
export { SqliteAdapter } from './adapters/sqlite.js'

// Validation helpers (useful if users want to validate callbacks outside MpesaStk)
export { validateCallbackStructure, validateCallbackAmount } from './validate.js'

// C2B (Customer to Business / Buy Goods & Paybill)
export {
  processC2BConfirmation,
  processC2BValidation,
  validateC2BPayload,
  parseTransTime,
  formatCustomerName,
} from './c2b.js'
export type {
  C2BCallbackPayload,
  C2BProcessResult,
  C2BValidationResponse,
} from './c2b.js'
