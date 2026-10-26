import { serve } from '@hono/node-server'
import { createBridgeApp } from '../src/bridge/server.js'
import { SqliteAdapter } from '../src/adapters/sqlite.js'
import type { MpesaConfig } from '../src/types.js'

const port = Number(process.env.PORT || 3000)
const dbPath = process.env.SQLITE_PATH || 'mpesa.db'

let mpesaConfig: MpesaConfig | undefined
if (
  process.env.MPESA_CONSUMER_KEY &&
  process.env.MPESA_CONSUMER_SECRET &&
  process.env.MPESA_SHORTCODE &&
  process.env.MPESA_PASSKEY
) {
  mpesaConfig = {
    consumerKey: process.env.MPESA_CONSUMER_KEY,
    consumerSecret: process.env.MPESA_CONSUMER_SECRET,
    shortCode: process.env.MPESA_SHORTCODE,
    passKey: process.env.MPESA_PASSKEY,
    callbackUrl: process.env.MPESA_CALLBACK_URL || `http://localhost:${port}/webhooks/stk`,
    environment: (process.env.MPESA_ENVIRONMENT as any) || 'sandbox',
  }
}

const storage = new SqliteAdapter(dbPath)
const { app } = createBridgeApp({
  port,
  mpesaConfig,
  storage,
  simulatedMode: !mpesaConfig,
})

const server = serve({
  fetch: app.fetch,
  port,
})

console.log(`
┌────────────────────────────────────────────────────────┐
│         M-PESA DARAJA CASHIER PAYMENT BRIDGE           │
│                                                        │
│  ✓ Server running: http://localhost:${port}             │
│  ✓ Mode:           ${mpesaConfig ? 'LIVE / SANDBOX DARAJA' : 'LOCAL SIMULATOR (No API keys needed)'}
│  ✓ Database:       SQLite (${dbPath})                  │
│  ✓ Features:       STK Prompt + C2B Message Store      │
│  ✓ Live SSE:       http://localhost:${port}/api/events      │
└────────────────────────────────────────────────────────┘
`)

export { server, app }
