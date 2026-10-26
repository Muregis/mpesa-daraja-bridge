# M-Pesa Daraja Payment Bridge

> **"Verify M-Pesa transactions in under 1 second without your cashier checking customer phones."**

A production-grade M-Pesa Daraja payment middleware and real-time cashier terminal designed specifically for **clinics, pharmacies, hardware shops, wholesalers, and retail checkouts**.

Eliminates **fake M-Pesa SMS fraud**, removes queue bottlenecks caused by cashiers inspecting customer phones, and automates **midnight bookkeeper reconciliation** against Safaricom statements.

---

## The Problems This Solves

| Traditional Retail Bottleneck | How M-Pesa Daraja Payment Bridge Solves It |
| :--- | :--- |
| **Fake M-Pesa SMS Fraud** (customers showing forged SMS, modified sender IDs, or fake SMS generator apps) | **Zero Phone Checking**: The cashier terminal lights up green **only** when Safaricom's cryptographic webhook callback hits your local server. Cashiers are strictly instructed to never touch or look at customer phones. |
| **Queue Delays at Checkout** (waiting 1–3 minutes for customer SMS delivery during network congestion) | **Sub-Second Verification**: Safaricom webhooks process in under 500ms, immediately broadcasting a verified checkmark and audio register chime to the cashier screen over Server-Sent Events (SSE). |
| **Manual Customer Till Payments** (customers who prefer typing the Till/Paybill number manually instead of accepting STK Push) | **Supermarket Message Store**: A live, real-time inbound feed of every incoming payment to your Till or Paybill. Cashiers can search by the **last 3–4 digits of the M-Pesa code** (e.g. `...9JK`) and click **"Link Bill"** in 1 second. |
| **Midnight Bookkeeper Reconciliation** (accountants spending hours matching hundreds of till transactions to paper receipts) | **Automated Reconciliation**: One-click daily shift summaries and clean CSV exports matching Safaricom M-Pesa statements with zero drift. |
| **Double Charging on Network Lag** (cashiers pressing "Pay" multiple times when a customer hesitates) | **Idempotent Dispatch & Atomic Compare-and-Swap (CAS)**: Guaranteed zero duplicate charges and zero double crediting. |

---

## Architecture

```text
               [Customer Phone]
                      │  ▲
           (STK Push) │  │ (Enters PIN or pays Till)
                      ▼  │
            [Safaricom Daraja API]
                      │
               (Instant Webhook POST < 1s)
                      ▼
┌────────────────────────────────────────────────────────┐
│             M-PESA DARAJA PAYMENT BRIDGE               │
│                                                        │
│  • STK Push Dispatcher & Poller Fallback               │
│  • C2B Till/Paybill Confirmation Listener              │
│  • Local SQLite (WAL Mode) / PostgreSQL Storage        │
│  • Atomic CAS Deduplication Guard (Zero Replay)        │
│  • Real-Time SSE Broadcaster (<10ms local push)        │
└──────────────────────────┬─────────────────────────────┘
                           │ (Server-Sent Events)
                           ▼
┌────────────────────────────────────────────────────────┐
│              CASHIER TERMINAL WORKSTATION              │
│                                                        │
│  • STK Prompt Station (Amount + Phone + Bill #)        │
│  • 60s Countdown with Live PIN Status                  │
│  • Sub-Second Green Tick ("✓ VERIFIED IN 0.8s")        │
│  • Dual-Tone Web Audio Synthesizer Chime               │
│  • Live Inbound Message Feed (Search by Code Suffix)   │
│  • 1-Click "Claim / Link to Bill #..."                 │
│  • Midnight Reconciliation & CSV Export                │
└────────────────────────────────────────────────────────┘
```

---

## Key Features

1. **Dual-Mode Payment Ingestion**:
   * **Mode A (STK Push / Express):** Cashier enters Amount + Phone number $\rightarrow$ Customer gets an instant prompt to enter PIN $\rightarrow$ Screen verifies automatically.
   * **Mode B (C2B Buy Goods Till / Paybill):** Customer manually pays Till `543210` $\rightarrow$ Webhook immediately streams into the **Message Store** $\rightarrow$ Cashier links it to Bill `#104` with one click.
2. **Supermarket-Style Code Search**:
   * Customer says: *"I've paid, code ends with 9KL"* $\rightarrow$ Cashier types `9KL` in the search bar $\rightarrow$ Transaction instantly highlights in green.
3. **Audio Register Chime**:
   * Plays a crisp, pleasant 2-tone register chime (880Hz + 1320Hz bell) through the cashier's computer speakers using the HTML5 Web Audio API (zero audio file dependencies).
4. **Zero-Config Local SQLite Database**:
   * Runs locally on a single cashier PC or local store server (`mpesa.db`) with zero setup. Uses Write-Ahead Logging (WAL) for instant concurrent reads and writes.
5. **Built-in Offline / Sandbox Simulator**:
   * Launch the system with zero API keys to test and train cashiers. Click *"Simulate KES 1,500 Till Payment"* to see the sub-second screen reaction.

---

## Quickstart

### 1. Installation

```bash
git clone https://github.com/Muregis/mpesa-daraja-bridge.git
cd mpesa-daraja-bridge
npm install
```

### 2. Run the Cashier Terminal (Simulator Mode)

To test the cashier interface and verify the workflow with zero setup:

```bash
npm run bridge
```

Open your browser to:
👉 **[http://localhost:3000](http://localhost:3000)**

Click **"⚡ Test & Training Simulator"** to trigger mock STK pushes and direct Till payments.

---

## Production Configuration

Create a `.env` file in the root directory:

```env
PORT=3000

# Safaricom Daraja API Credentials (from https://developer.safaricom.co.ke)
MPESA_ENVIRONMENT=production        # "sandbox" or "production"
MPESA_CONSUMER_KEY=your_key
MPESA_CONSUMER_SECRET=your_secret
MPESA_SHORTCODE=your_shortcode      # Paybill or Buy Goods Till shortcode
MPESA_PASSKEY=your_passkey          # Lipa na M-Pesa Online passkey
MPESA_CALLBACK_URL=https://your-domain.com/webhooks/stk

# Database (defaults to local zero-config SQLite if omitted)
SQLITE_PATH=mpesa.db

# Or use PostgreSQL for multi-till cloud deployments:
# DATABASE_URL=postgresql://user:password@localhost:5432/mpesa_db
```

### Safaricom Webhook Registration

In your Safaricom Developer Portal or via the C2B RegisterURL API, configure:
* **STK Push Callback URL:** `https://your-domain.com/webhooks/stk`
* **C2B Confirmation URL:** `https://your-domain.com/webhooks/c2b/confirmation`
* **C2B Validation URL:** `https://your-domain.com/webhooks/c2b/validation`

---

## API Reference

The bridge provides a REST API that your existing POS, billing software, or pharmacy dispensing system can integrate with:

### 1. Trigger STK Prompt
```http
POST /api/payments/prompt
Content-Type: application/json

{
  "amount": 1500,
  "phoneNumber": "0712345678",
  "billReference": "INV-402"
}
```
**Response (200 OK):**
```json
{
  "paymentId": "43e9ac7b-...",
  "checkoutRequestId": "ws_CO_26102026...",
  "status": "PENDING"
}
```

### 2. Live Message Store Feed
```http
GET /api/payments/feed?search=KL9&limit=50
```
**Response (200 OK):**
```json
{
  "payments": [
    {
      "id": "c2b_QJD82KL9",
      "mpesaReceiptNumber": "QJD82KL9",
      "amount": 1500,
      "phoneNumber": "254712345678",
      "customerName": "JOHN DOE",
      "paymentType": "C2B",
      "accountReference": "INV-402",
      "status": "SUCCESS",
      "initiatedAt": "2026-10-26T07:45:12.000Z"
    }
  ]
}
```

### 3. Claim / Link Payment to Bill
```http
POST /api/payments/:id/claim
Content-Type: application/json

{
  "billReference": "INV-500"
}
```

### 4. Midnight Reconciliation Summary
```http
GET /api/reconciliation/summary
```
**Response (200 OK):**
```json
{
  "date": "2026-10-26",
  "totalAmount": 145000,
  "totalCount": 84,
  "stkCount": 52,
  "c2bCount": 32,
  "failedCount": 2
}
```

### 5. Download Bookkeeper CSV
```http
GET /api/reconciliation/export.csv
```
Returns a downloadable spreadsheet:
```csv
Date,Time,ReceiptNumber,Channel,CustomerName,PhoneNumber,Amount_KES,BillReference,Status
2026-10-26,10:45:12,QJD82KL9,C2B,"JOHN DOE",254712345678,1500,"INV-402",SUCCESS
```

---

## Testing

Run the full automated test suite (243 tests):

```bash
npm test
```

Build library distributions (ESM, CJS, and TypeScript `.d.ts`):

```bash
npm run build
```

---

## License

MIT © [Muregis](https://github.com/Muregis) and contributors.
Originally forked from [ronnyabuto/mpesa-stk](https://github.com/ronnyabuto/mpesa-stk).
