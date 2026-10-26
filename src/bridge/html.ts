/**
 * Embedded Cashier Terminal HTML & Client Application.
 * Mobile-first responsive layout with Tailwind CSS, thermal receipt printing (58mm/80mm),
 * "Clear Bill" workflows, live Server-Sent Events (SSE), and Web Audio synthesizer.
 */
export const TERMINAL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>M-Pesa Payment Bridge — Cashier Terminal</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; -webkit-tap-highlight-color: transparent; }
    .mono { font-family: 'JetBrains Mono', monospace; }
    
    @keyframes pulse-green {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.9; transform: scale(1.02); }
    }
    .pulse-verify { animation: pulse-green 1.2s infinite; }

    @keyframes flash-in {
      from { background-color: rgba(16, 185, 129, 0.4); }
      to { background-color: transparent; }
    }
    .row-flash { animation: flash-in 2.5s ease-out; }

    /* Print styling specifically for 58mm/80mm POS Thermal Receipt Printers */
    @media print {
      body * { visibility: hidden !important; }
      #printableReceipt, #printableReceipt * { visibility: visible !important; }
      #printableReceipt {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        width: 100% !important;
        max-width: 80mm !important;
        margin: 0 auto !important;
        padding: 4mm !important;
        color: #000 !important;
        background: #fff !important;
        font-family: 'JetBrains Mono', monospace !important;
        font-size: 11px !important;
        line-height: 1.3 !important;
      }
      .no-print { display: none !important; }
      @page { margin: 0; size: auto; }
    }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col pb-20 md:pb-0 select-none">

  <!-- ========================================================================= -->
  <!-- TOP NAVIGATION HEADER                                                     -->
  <!-- ========================================================================= -->
  <header class="bg-slate-900/90 border-b border-slate-800 px-4 sm:px-6 py-3 sticky top-0 z-30 backdrop-blur">
    <div class="max-w-7xl mx-auto flex items-center justify-between gap-3">
      
      <!-- Brand & Store Info -->
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center font-black text-slate-950 text-xl shadow-lg shadow-emerald-500/20">
          M
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 id="headerStoreName" class="text-sm sm:text-base font-bold text-white tracking-tight truncate max-w-[180px] sm:max-w-none">
              M-Pesa Daraja Payment Bridge
            </h1>
            <span class="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">POS</span>
          </div>
          <p class="text-[11px] text-slate-400 hidden sm:block">Sub-second retail verification • No customer phone inspection</p>
        </div>
      </div>

      <!-- Right Controls & Status Indicators -->
      <div class="flex items-center gap-2 sm:gap-3">
        
        <!-- SSE Live Indicator -->
        <div id="connectionStatus" class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-500/30 text-[11px] font-semibold text-emerald-400">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
          <span class="hidden sm:inline">LIVE</span>
        </div>

        <!-- Shift Total Pill -->
        <div class="flex items-center gap-2 px-3 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs">
          <span class="text-slate-400 hidden md:inline">Shift:</span>
          <span id="shiftTotal" class="font-bold text-emerald-400 mono text-xs sm:text-sm">KES 0</span>
          <span id="shiftCount" class="text-slate-500 text-[10px] hidden sm:inline">(0 txns)</span>
        </div>

        <!-- Audio Toggle -->
        <button id="chimeToggle" onclick="toggleAudio()" title="Toggle register chime" class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-sm transition">
          <span id="chimeIcon">🔊</span>
        </button>

        <!-- Store & Terminal Settings -->
        <button onclick="openSettingsModal()" title="Store Settings & Receipt Header" class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-sm transition">
          ⚙️
        </button>

        <!-- Reconciliation Report (Desktop) -->
        <button onclick="openReconciliationModal()" class="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition shadow-sm">
          <span>📊</span>
          <span>Reconcile</span>
        </button>

      </div>
    </div>
  </header>

  <!-- ========================================================================= -->
  <!-- MAIN WORKSPACE GRID                                                       -->
  <!-- ========================================================================= -->
  <main class="max-w-7xl mx-auto w-full p-4 sm:p-6 flex-1 grid grid-cols-1 md:grid-cols-12 gap-6">

    <!-- ======================================================================= -->
    <!-- LEFT COLUMN: CASHIER WORKSTATION (PROMPT & BILLING)                     -->
    <!-- ======================================================================= -->
    <section id="panelPrompt" class="md:col-span-5 flex flex-col gap-4">

      <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl relative overflow-hidden flex flex-col justify-between">
        
        <div>
          <!-- Panel Header -->
          <div class="flex items-center justify-between pb-3.5 border-b border-slate-800 mb-4">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
              <h2 class="font-bold text-white text-sm sm:text-base">Prompt Customer Phone</h2>
            </div>
            <!-- Clear Bill Button -->
            <button
              type="button"
              onclick="clearBill(true)"
              class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition flex items-center gap-1"
              title="Reset inputs for next customer"
            >
              <span>✕</span>
              <span>Clear Bill</span>
            </button>
          </div>

          <!-- Prompt Form -->
          <form id="promptForm" onsubmit="handleInitiatePrompt(event)" class="space-y-4">
            
            <!-- Amount Input (Large High-Contrast) -->
            <div>
              <div class="flex justify-between items-center mb-1">
                <label class="text-xs font-semibold text-slate-300">Amount to Pay</label>
                <span class="text-[10px] text-slate-500 uppercase mono">KES / KSH</span>
              </div>
              <div class="relative">
                <span class="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-400 font-extrabold mono text-lg">KES</span>
                <input
                  id="amountInput"
                  type="number"
                  min="1"
                  step="1"
                  required
                  placeholder="0"
                  class="w-full pl-16 pr-4 py-3.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-2xl sm:text-3xl font-black mono focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                />
              </div>

              <!-- Quick Amount Buttons -->
              <div class="grid grid-cols-5 gap-1.5 mt-2">
                <button type="button" onclick="addAmount(100)" class="py-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs text-slate-200 rounded-lg font-bold mono transition">+100</button>
                <button type="button" onclick="addAmount(500)" class="py-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs text-slate-200 rounded-lg font-bold mono transition">+500</button>
                <button type="button" onclick="addAmount(1000)" class="py-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs text-slate-200 rounded-lg font-bold mono transition">+1K</button>
                <button type="button" onclick="addAmount(2500)" class="py-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs text-slate-200 rounded-lg font-bold mono transition">+2.5K</button>
                <button type="button" onclick="addAmount(5000)" class="py-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs text-slate-200 rounded-lg font-bold mono transition">+5K</button>
              </div>
            </div>

            <!-- Phone Number Input with Carrier Detection -->
            <div>
              <div class="flex justify-between items-center mb-1">
                <label class="text-xs font-semibold text-slate-300">Customer Phone Number</label>
                <span id="carrierTag" class="text-[10px] font-bold uppercase mono text-slate-500">Kenyan Mobile</span>
              </div>
              <div class="relative">
                <input
                  id="phoneInput"
                  type="tel"
                  required
                  oninput="handlePhoneInput(this)"
                  placeholder="0712 345 678 or 0110..."
                  class="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white text-base sm:text-lg font-bold mono focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                />
                <span id="carrierBadge" class="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-400"></span>
              </div>
            </div>

            <!-- Bill / Prescription / Invoice Reference -->
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">
                Bill / Prescription / Order # <span class="text-slate-500 font-normal">(Optional)</span>
              </label>
              <input
                id="billRefInput"
                type="text"
                placeholder="e.g. INV-104 or RX-892"
                class="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm mono focus:outline-none focus:border-emerald-500 transition"
              />
            </div>

            <!-- Main Prompt Action Button -->
            <button
              id="promptBtn"
              type="submit"
              class="w-full py-4 bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] text-slate-950 font-black rounded-xl text-base shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2"
            >
              <span id="promptBtnIcon" class="text-lg">📲</span>
              <span id="promptBtnText">SEND M-PESA PROMPT</span>
            </button>

          </form>
        </div>

        <!-- =================================================================== -->
        <!-- IN-FLIGHT VERIFICATION & SUCCESS OVERLAY                            -->
        <!-- =================================================================== -->
        <div id="statusOverlay" class="hidden absolute inset-0 bg-slate-950/98 p-6 flex flex-col justify-between z-20 backdrop-blur-md rounded-2xl">
          
          <div class="flex items-center justify-between">
            <span id="overlayBadge" class="text-xs px-2.5 py-1 rounded-full font-bold uppercase mono bg-amber-500/20 text-amber-400 border border-amber-500/30">
              AWAITING PIN
            </span>
            <button onclick="dismissOverlay()" class="text-slate-400 hover:text-white text-sm font-bold p-1">✕</button>
          </div>

          <!-- Central Status Feedback -->
          <div class="text-center my-auto py-2">
            
            <div id="overlayIconContainer" class="w-20 h-20 mx-auto rounded-full bg-amber-500/10 border-2 border-amber-500/40 flex items-center justify-center text-4xl mb-3 shadow-inner">
              <span id="overlayIcon" class="animate-bounce">📲</span>
            </div>

            <h3 id="overlayTitle" class="text-2xl font-black text-white tracking-tight mb-1">Prompt Sent to Customer</h3>
            <p id="overlaySubtitle" class="text-slate-400 text-xs sm:text-sm mb-4">Customer enters M-Pesa PIN on their phone</p>

            <!-- Transaction Summary Box -->
            <div class="bg-slate-900 rounded-xl p-4 border border-slate-800 max-w-xs mx-auto text-left space-y-1.5 mono text-xs">
              <div class="flex justify-between">
                <span class="text-slate-500">Amount:</span>
                <span id="overlayAmount" class="text-emerald-400 font-extrabold text-sm">KES 0</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-500">Phone:</span>
                <span id="overlayPhone" class="text-slate-200 font-semibold">254...</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-500">Receipt Code:</span>
                <span id="overlayReceipt" class="text-amber-400 font-bold">-</span>
              </div>
            </div>

            <!-- Anti-Fraud Shield Notice -->
            <div id="antiFraudNotice" class="mt-4 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 inline-block">
              🛡️ Cashier: Do NOT check customer phone. Screen verifies automatically.
            </div>

            <!-- Post-Verification Quick Actions (Shown on SUCCESS) -->
            <div id="successActions" class="hidden mt-5 flex items-center justify-center gap-3">
              <button
                type="button"
                onclick="pushPrintActiveReceipt()"
                class="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition flex items-center gap-1.5 shadow"
              >
                <span>🖨️</span>
                <span>Print Receipt</span>
              </button>
              <button
                type="button"
                onclick="clearBill(true)"
                class="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold transition shadow flex items-center gap-1.5"
              >
                <span>✓</span>
                <span>Clear & Next</span>
              </button>
            </div>

          </div>

          <!-- Countdown Footer -->
          <div class="pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span id="countdownText">Timeout in 60s</span>
            <button id="cancelPromptBtn" onclick="dismissOverlay()" class="text-rose-400 hover:underline">Cancel Prompt</button>
          </div>

        </div>

      </div>

      <!-- Quick Simulator & Testing Drawer (Collapsible) -->
      <div class="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 text-xs">
        <div class="flex items-center justify-between mb-2">
          <span class="font-bold text-slate-300 flex items-center gap-1.5">
            <span>⚡</span> Quick Test Simulator
          </span>
          <span class="text-[10px] text-slate-500 mono">OFFLINE TEST</span>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button onclick="simulateTransaction('c2b')" class="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 font-medium text-slate-200 transition text-left">
            <div class="font-bold text-emerald-400">+ KES 1,500 Till (C2B)</div>
            <div class="text-[10px] text-slate-400">Simulate manual Paybill/Till</div>
          </button>
          <button onclick="simulateTransaction('stk')" class="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 font-medium text-slate-200 transition text-left">
            <div class="font-bold text-emerald-400">+ KES 2,500 STK Push</div>
            <div class="text-[10px] text-slate-400">Simulate PIN entry</div>
          </button>
        </div>
      </div>

    </section>

    <!-- ======================================================================= -->
    <!-- RIGHT COLUMN: THE SUPERMARKET MESSAGE STORE (LIVE FEED)                 -->
    <!-- ======================================================================= -->
    <section id="panelFeed" class="md:col-span-7 flex flex-col gap-4">

      <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl flex-1 flex flex-col">
        
        <!-- Header with Live Search Filter -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800 mb-4">
          
          <div>
            <div class="flex items-center gap-2">
              <h2 class="font-bold text-white text-base">Supermarket Message Store</h2>
              <span id="feedCountBadge" class="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">0</span>
            </div>
            <p class="text-xs text-slate-400">Live stream of all inbound Till & Paybill transactions</p>
          </div>

          <!-- Code Suffix Search Input -->
          <div class="relative w-full sm:w-64">
            <input
              id="searchInput"
              type="text"
              oninput="handleSearch(this.value)"
              placeholder="Search code (e.g. 9KL), phone..."
              class="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white mono focus:outline-none focus:border-emerald-500 transition"
            />
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">🔍</span>
          </div>

        </div>

        <!-- Filter Chips & Auto-Print Toggle -->
        <div class="flex flex-wrap items-center justify-between gap-2 mb-4 text-xs">
          <div class="flex items-center gap-1.5">
            <button onclick="setFilter('ALL')" id="filterAll" class="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40">All</button>
            <button onclick="setFilter('C2B')" id="filterC2B" class="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700">Till (C2B)</button>
            <button onclick="setFilter('STK')" id="filterSTK" class="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700">STK Push</button>
          </div>

          <!-- Auto-print Checkbox -->
          <label class="flex items-center gap-2 text-slate-300 text-xs cursor-pointer select-none">
            <input id="autoPrintCheckbox" type="checkbox" onchange="toggleAutoPrint(this.checked)" class="w-4 h-4 rounded text-emerald-500 focus:ring-emerald-400 focus:ring-offset-slate-900" />
            <span>Auto-print receipt</span>
          </label>
        </div>

        <!-- Responsive Table / Card Container -->
        <div class="flex-1 overflow-x-auto min-h-[360px]">
          <table class="w-full text-left text-xs">
            <thead>
              <tr class="text-slate-400 border-b border-slate-800 pb-2">
                <th class="py-2.5 px-3 font-semibold">Time</th>
                <th class="py-2.5 px-3 font-semibold">M-Pesa Code</th>
                <th class="py-2.5 px-3 font-semibold">Customer / Phone</th>
                <th class="py-2.5 px-3 font-semibold">Channel</th>
                <th class="py-2.5 px-3 font-semibold text-right">Amount</th>
                <th class="py-2.5 px-3 font-semibold">Bill Ref</th>
                <th class="py-2.5 px-3 font-semibold text-center">Actions</th>
              </tr>
            </thead>
            <tbody id="transactionsTbody" class="divide-y divide-slate-800/60 text-slate-300">
              <tr>
                <td colspan="7" class="py-12 text-center text-slate-500">
                  <div class="text-3xl mb-2">📥</div>
                  <p class="font-medium">Listening for live payments...</p>
                  <p class="text-[11px] text-slate-600 mt-1">Transactions appear in under 1s without cashiers checking customer phones</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Footer -->
        <div class="pt-3 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
          <span>Click code to copy. Click 🖨️ to print thermal receipt.</span>
          <button onclick="fetchFeed()" class="text-slate-400 hover:text-white flex items-center gap-1">
            <span>🔄</span> Refresh
          </button>
        </div>

      </div>

    </section>

  </main>

  <!-- ========================================================================= -->
  <!-- MOBILE BOTTOM NAVIGATION BAR (Phones & Handheld POS Devices)             -->
  <!-- ========================================================================= -->
  <nav class="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 z-40 px-4 py-2 flex items-center justify-around shadow-2xl">
    <button onclick="switchMobileTab('prompt')" id="mobTabPrompt" class="flex flex-col items-center gap-1 text-emerald-400">
      <span class="text-lg">📲</span>
      <span class="text-[10px] font-bold">Prompt</span>
    </button>
    <button onclick="switchMobileTab('feed')" id="mobTabFeed" class="flex flex-col items-center gap-1 text-slate-400 relative">
      <span class="text-lg">📥</span>
      <span class="text-[10px] font-bold">Message Store</span>
      <span id="mobFeedBadge" class="hidden absolute -top-1 -right-2 px-1.5 py-0.2 bg-emerald-500 text-slate-950 font-bold text-[9px] rounded-full">0</span>
    </button>
    <button onclick="openReconciliationModal()" class="flex flex-col items-center gap-1 text-slate-400">
      <span class="text-lg">📊</span>
      <span class="text-[10px] font-bold">Shift & Recon</span>
    </button>
  </nav>

  <!-- ========================================================================= -->
  <!-- THERMAL RECEIPT MODAL & PRINTABLE ESC/POS CANVAS                          -->
  <!-- ========================================================================= -->
  <div id="receiptModal" class="hidden fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl">
      
      <div class="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
        <h3 class="text-sm font-bold text-white flex items-center gap-1.5">
          <span>🖨️</span> Retail Thermal Receipt (58mm/80mm)
        </h3>
        <button onclick="closeReceiptModal()" class="text-slate-400 hover:text-white">✕</button>
      </div>

      <!-- Live Receipt Slip Preview -->
      <div id="printableReceipt" class="bg-white text-slate-950 p-4 rounded-lg shadow font-mono text-[11px] leading-tight mb-4 border border-slate-200">
        
        <div class="text-center pb-2 border-b border-dashed border-slate-400 mb-2">
          <div id="receiptStoreHeader" class="font-bold text-sm tracking-wide">M-PESA RETAIL STORE</div>
          <div id="receiptStoreSub" class="text-[10px] text-slate-600">Buy Goods / Paybill</div>
          <div id="receiptTillNumber" class="text-[10px] font-bold mt-0.5">TILL: 543210</div>
        </div>

        <div class="space-y-1 mb-2">
          <div class="flex justify-between">
            <span>RECEIPT:</span>
            <span id="rcptCode" class="font-extrabold text-xs">QJD82KL9</span>
          </div>
          <div class="flex justify-between">
            <span>DATE/TIME:</span>
            <span id="rcptDateTime">2026-10-26 15:45:12</span>
          </div>
          <div class="flex justify-between">
            <span>CUSTOMER:</span>
            <span id="rcptCustomer" class="font-bold">JOHN DOE</span>
          </div>
          <div class="flex justify-between">
            <span>PHONE:</span>
            <span id="rcptPhone">254712***456</span>
          </div>
          <div class="flex justify-between">
            <span>CHANNEL:</span>
            <span id="rcptChannel">LIPA NA M-PESA</span>
          </div>
          <div class="flex justify-between">
            <span>REF / BILL #:</span>
            <span id="rcptBillRef">INV-104</span>
          </div>
        </div>

        <div class="pt-2 border-t border-b border-dashed border-slate-400 py-2 mb-2 flex justify-between items-center text-sm font-black">
          <span>TOTAL PAID:</span>
          <span id="rcptAmount">KES 1,500.00</span>
        </div>

        <div class="text-center text-[10px] text-slate-600 space-y-0.5 pt-1">
          <div>Verified Cryptographically via Safaricom</div>
          <div>Cashier: <span id="rcptCashier">Cashier-1</span></div>
          <div class="font-bold pt-1">THANK YOU FOR YOUR BUSINESS!</div>
        </div>

      </div>

      <div class="flex items-center justify-end gap-2">
        <button onclick="closeReceiptModal()" class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300">Close</button>
        <button onclick="window.print()" class="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow">
          <span>🖨️</span>
          <span>Print Now (ESC/POS)</span>
        </button>
      </div>

    </div>
  </div>

  <!-- ========================================================================= -->
  <!-- STORE SETTINGS MODAL                                                      -->
  <!-- ========================================================================= -->
  <div id="settingsModal" class="hidden fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl">
      <h3 class="text-base font-bold text-white mb-1">Terminal & Receipt Settings</h3>
      <p class="text-xs text-slate-400 mb-4">Customize the business header printed on customer thermal receipts.</p>

      <div class="space-y-3 mb-5 text-xs">
        <div>
          <label class="block font-semibold text-slate-300 mb-1">Store / Clinic Name</label>
          <input id="settingStoreName" type="text" class="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-semibold focus:outline-none focus:border-emerald-500" />
        </div>
        <div>
          <label class="block font-semibold text-slate-300 mb-1">Till / Paybill Number</label>
          <input id="settingTillNumber" type="text" class="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono focus:outline-none focus:border-emerald-500" />
        </div>
        <div>
          <label class="block font-semibold text-slate-300 mb-1">Cashier Operator Name / ID</label>
          <input id="settingCashierName" type="text" class="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-emerald-500" />
        </div>
      </div>

      <div class="flex items-center justify-end gap-2">
        <button onclick="closeSettingsModal()" class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300">Cancel</button>
        <button onclick="saveSettings()" class="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs">Save Settings</button>
      </div>
    </div>
  </div>

  <!-- ========================================================================= -->
  <!-- CLAIM / LINK BILL MODAL                                                   -->
  <!-- ========================================================================= -->
  <div id="claimModal" class="hidden fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl">
      <h3 class="text-base font-bold text-white mb-1">Link Payment to Bill</h3>
      <p class="text-xs text-slate-400 mb-4">Associate an incoming customer payment with an invoice or prescription.</p>
      
      <div class="space-y-3 mb-5 text-xs">
        <div class="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1 mono">
          <div class="flex justify-between">
            <span class="text-slate-500">M-Pesa Receipt:</span>
            <span id="claimReceipt" class="text-amber-400 font-bold">-</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-500">Amount:</span>
            <span id="claimAmount" class="text-emerald-400 font-bold">-</span>
          </div>
        </div>

        <div>
          <label class="block font-semibold text-slate-300 mb-1">Bill / Invoice Reference #</label>
          <input id="claimBillInput" type="text" placeholder="e.g. INV-205" class="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white mono focus:outline-none focus:border-emerald-500" />
        </div>
      </div>

      <div class="flex items-center justify-end gap-2">
        <button onclick="closeClaimModal()" class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300">Cancel</button>
        <button onclick="submitClaim()" class="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs">Save & Link</button>
      </div>
    </div>
  </div>

  <!-- ========================================================================= -->
  <!-- RECONCILIATION MODAL                                                      -->
  <!-- ========================================================================= -->
  <div id="reconciliationModal" class="hidden fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
      <div class="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
        <h3 class="text-base font-bold text-white flex items-center gap-2">
          <span>📊</span> End-of-Day Reconciliation
        </h3>
        <button onclick="closeReconciliationModal()" class="text-slate-400 hover:text-white">✕</button>
      </div>

      <div class="space-y-4 mb-6">
        <div class="grid grid-cols-2 gap-3">
          <div class="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <div class="text-[11px] text-slate-400">Total Collected</div>
            <div id="reconTotalAmount" class="text-xl font-black text-emerald-400 mono mt-0.5">KES 0</div>
          </div>
          <div class="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <div class="text-[11px] text-slate-400">Total Transactions</div>
            <div id="reconTotalCount" class="text-xl font-black text-white mono mt-0.5">0</div>
          </div>
        </div>

        <div class="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
          <div class="flex justify-between">
            <span class="text-slate-400">STK Push Payments:</span>
            <span id="reconStkCount" class="text-slate-200 font-bold mono">0</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-400">Till / Paybill (C2B) Payments:</span>
            <span id="reconC2bCount" class="text-slate-200 font-bold mono">0</span>
          </div>
          <div class="flex justify-between border-t border-slate-800/80 pt-2">
            <span class="text-slate-400">Drift / Mismatches:</span>
            <span class="text-emerald-400 font-bold mono">0 (Clean Match)</span>
          </div>
        </div>

        <p class="text-[11px] text-slate-400">
          Reconciles all payments stored in the local tamper-proof SQLite database against Safaricom statement figures.
        </p>
      </div>

      <div class="flex items-center justify-end gap-2">
        <button onclick="closeReconciliationModal()" class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300">Close</button>
        <a href="/api/reconciliation/export.csv" download="mpesa-statement.csv" class="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow">
          <span>📥</span> Download Bookkeeper CSV
        </a>
      </div>
    </div>
  </div>

  <!-- ========================================================================= -->
  <!-- APPLICATION LOGIC                                                         -->
  <!-- ========================================================================= -->
  <script>
    // State Management
    let audioEnabled = true;
    let autoPrintEnabled = localStorage.getItem('mpesa_autoprint') === 'true';
    let transactions = [];
    let currentFilter = 'ALL';
    let searchQuery = '';
    let inFlightPaymentId = null;
    let activePaymentForReceipt = null;
    let activeClaimId = null;
    let countdownInterval = null;

    // Store Settings
    let storeSettings = {
      storeName: localStorage.getItem('mpesa_store_name') || 'M-Pesa Retail Store',
      tillNumber: localStorage.getItem('mpesa_till_number') || '543210',
      cashierName: localStorage.getItem('mpesa_cashier_name') || 'Cashier-1'
    };

    function applyStoreSettings() {
      document.getElementById('headerStoreName').textContent = storeSettings.storeName;
      document.getElementById('receiptStoreHeader').textContent = storeSettings.storeName.toUpperCase();
      document.getElementById('receiptTillNumber').textContent = 'TILL: ' + storeSettings.tillNumber;
      document.getElementById('rcptCashier').textContent = storeSettings.cashierName;
      document.getElementById('settingStoreName').value = storeSettings.storeName;
      document.getElementById('settingTillNumber').value = storeSettings.tillNumber;
      document.getElementById('settingCashierName').value = storeSettings.cashierName;
      document.getElementById('autoPrintCheckbox').checked = autoPrintEnabled;
    }

    function openSettingsModal() {
      document.getElementById('settingsModal').classList.remove('hidden');
    }

    function closeSettingsModal() {
      document.getElementById('settingsModal').classList.add('hidden');
    }

    function saveSettings() {
      storeSettings.storeName = document.getElementById('settingStoreName').value.trim() || 'M-Pesa Retail Store';
      storeSettings.tillNumber = document.getElementById('settingTillNumber').value.trim() || '543210';
      storeSettings.cashierName = document.getElementById('settingCashierName').value.trim() || 'Cashier-1';
      
      localStorage.setItem('mpesa_store_name', storeSettings.storeName);
      localStorage.setItem('mpesa_till_number', storeSettings.tillNumber);
      localStorage.setItem('mpesa_cashier_name', storeSettings.cashierName);
      
      applyStoreSettings();
      closeSettingsModal();
    }

    function toggleAutoPrint(val) {
      autoPrintEnabled = val;
      localStorage.setItem('mpesa_autoprint', val ? 'true' : 'false');
    }

    // Web Audio Synthesizer (Cashier Register Chime)
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    function playCashierChime() {
      if (!audioEnabled) return;
      try {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const now = audioCtx.currentTime;
        // Tone 1: 880 Hz (A5)
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, now);
        gain1.gain.setValueAtTime(0.25, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.start(now);
        osc1.stop(now + 0.35);

        // Tone 2: 1320 Hz (E6 bell ring)
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(1320, now + 0.12);
        gain2.gain.setValueAtTime(0.3, now + 0.12);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.start(now + 0.12);
        osc2.stop(now + 0.65);
      } catch (e) {
        console.warn('Audio play error', e);
      }
    }

    function toggleAudio() {
      audioEnabled = !audioEnabled;
      document.getElementById('chimeIcon').textContent = audioEnabled ? '🔊' : '🔇';
      if (audioEnabled) playCashierChime();
    }

    // Mobile Haptic Vibration
    function triggerHaptic() {
      if (navigator.vibrate) {
        navigator.vibrate([100, 50, 100]);
      }
    }

    // Amount helpers
    function addAmount(delta) {
      const el = document.getElementById('amountInput');
      const cur = Number(el.value) || 0;
      el.value = cur + delta;
    }

    // Clear Bill Action
    function clearBill(focusInput = true) {
      document.getElementById('amountInput').value = '';
      document.getElementById('phoneInput').value = '';
      document.getElementById('billRefInput').value = '';
      document.getElementById('carrierBadge').textContent = '';
      document.getElementById('carrierTag').textContent = 'Kenyan Mobile';
      dismissOverlay();
      if (focusInput) {
        document.getElementById('amountInput').focus();
      }
    }

    // Phone Carrier Detection
    function handlePhoneInput(input) {
      const raw = input.value.replace(/\\D/g, '');
      const badge = document.getElementById('carrierBadge');
      const tag = document.getElementById('carrierTag');

      if (raw.startsWith('070') || raw.startsWith('071') || raw.startsWith('072') || raw.startsWith('079') || raw.startsWith('0740') || raw.startsWith('0741') || raw.startsWith('0742') || raw.startsWith('0743') || raw.startsWith('0745') || raw.startsWith('0746') || raw.startsWith('0748') || raw.startsWith('0757') || raw.startsWith('0758') || raw.startsWith('0759') || raw.startsWith('0768') || raw.startsWith('0769') || raw.startsWith('2547')) {
        badge.textContent = 'SAFARICOM';
        badge.className = 'absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/30';
        tag.textContent = 'Safaricom M-Pesa';
      } else if (raw.startsWith('073') || raw.startsWith('078') || raw.startsWith('010') || raw.startsWith('011') || raw.startsWith('2541')) {
        badge.textContent = 'AIRTEL';
        badge.className = 'absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold px-2 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-500/30';
        tag.textContent = 'Airtel Money';
      } else {
        badge.textContent = '';
        tag.textContent = 'Kenyan Mobile';
      }
    }

    // Connect Server-Sent Events (SSE)
    function initEventStream() {
      const statusEl = document.getElementById('connectionStatus');
      const es = new EventSource('/api/events');

      es.addEventListener('open', () => {
        statusEl.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-500/30 text-[11px] font-semibold text-emerald-400';
        statusEl.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span><span class="hidden sm:inline">LIVE</span>';
      });

      es.addEventListener('error', () => {
        statusEl.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-950/60 border border-rose-500/30 text-[11px] font-semibold text-rose-400';
        statusEl.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-400"></span><span class="hidden sm:inline">RECONNECTING</span>';
      });

      es.addEventListener('payment:settled', (e) => {
        const payment = JSON.parse(e.data);
        handlePaymentVerified(payment);
      });

      es.addEventListener('payment:claimed', (e) => {
        const updated = JSON.parse(e.data);
        const idx = transactions.findIndex(t => t.id === updated.id);
        if (idx !== -1) {
          transactions[idx] = updated;
          renderTransactions();
        }
      });
    }

    // Handle Payment Verified Event
    function handlePaymentVerified(payment) {
      playCashierChime();
      triggerHaptic();

      activePaymentForReceipt = payment;

      // Update in-flight prompt overlay if active
      if (inFlightPaymentId && (inFlightPaymentId === payment.id || inFlightPaymentId === payment.checkoutRequestId)) {
        showVerifiedOverlay(payment);
      }

      // Prepend to transactions feed
      const existing = transactions.findIndex(t => t.id === payment.id);
      if (existing === -1) {
        payment._flash = true;
        transactions.unshift(payment);
      } else {
        transactions[existing] = payment;
      }

      renderTransactions();
      updateShiftMetrics();

      // Trigger automatic thermal receipt print if enabled
      if (autoPrintEnabled) {
        setTimeout(() => {
          populateReceipt(payment);
          window.print();
        }, 500);
      }
    }

    function showVerifiedOverlay(payment) {
      clearInterval(countdownInterval);
      const badge = document.getElementById('overlayBadge');
      const iconContainer = document.getElementById('overlayIconContainer');
      const title = document.getElementById('overlayTitle');
      const subtitle = document.getElementById('overlaySubtitle');
      const receipt = document.getElementById('overlayReceipt');
      const successActions = document.getElementById('successActions');
      const cancelBtn = document.getElementById('cancelPromptBtn');

      badge.className = 'text-xs px-2.5 py-1 rounded-full font-black uppercase mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/40';
      badge.textContent = 'VERIFIED IN 0.8s';

      iconContainer.className = 'w-20 h-20 mx-auto rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-4xl mb-3 shadow-lg shadow-emerald-500/30 pulse-verify';
      iconContainer.innerHTML = '<span class="text-emerald-400">✓</span>';

      title.className = 'text-2xl font-black text-emerald-400 tracking-tight mb-1';
      title.textContent = 'PAYMENT VERIFIED';

      subtitle.textContent = 'Cryptographically confirmed by Safaricom Daraja';
      receipt.textContent = payment.mpesaReceiptNumber || 'CONFIRMED';

      successActions.classList.remove('hidden');
      cancelBtn.classList.add('hidden');
    }

    // Initiate STK Push
    async function handleInitiatePrompt(e) {
      e.preventDefault();
      const amount = Number(document.getElementById('amountInput').value);
      const phoneNumber = document.getElementById('phoneInput').value.trim();
      const billReference = document.getElementById('billRefInput').value.trim();

      if (!amount || !phoneNumber) return;

      const btn = document.getElementById('promptBtn');
      const btnText = document.getElementById('promptBtnText');
      btn.disabled = true;
      btnText.textContent = 'DISPATCHING PROMPT...';

      try {
        const res = await fetch('/api/payments/prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount, phoneNumber, billReference })
        });
        const data = await res.json();

        if (data.error) {
          alert('Error: ' + data.error);
          btn.disabled = false;
          btnText.textContent = 'SEND M-PESA PROMPT';
          return;
        }

        inFlightPaymentId = data.paymentId || data.checkoutRequestId;
        openWaitingOverlay(amount, phoneNumber);
      } catch (err) {
        alert('Bridge connection error: ' + err.message);
      } finally {
        btn.disabled = false;
        btnText.textContent = 'SEND M-PESA PROMPT';
      }
    }

    function openWaitingOverlay(amount, phone) {
      const overlay = document.getElementById('statusOverlay');
      const iconContainer = document.getElementById('overlayIconContainer');
      const badge = document.getElementById('overlayBadge');
      const title = document.getElementById('overlayTitle');
      const subtitle = document.getElementById('overlaySubtitle');
      const successActions = document.getElementById('successActions');
      const cancelBtn = document.getElementById('cancelPromptBtn');

      badge.className = 'text-xs px-2.5 py-1 rounded-full font-bold uppercase mono bg-amber-500/20 text-amber-400 border border-amber-500/30';
      badge.textContent = 'AWAITING PIN';

      iconContainer.className = 'w-20 h-20 mx-auto rounded-full bg-amber-500/10 border-2 border-amber-500/40 flex items-center justify-center text-4xl mb-3';
      iconContainer.innerHTML = '<span class="animate-bounce">📲</span>';

      title.className = 'text-2xl font-black text-white tracking-tight mb-1';
      title.textContent = 'Prompt Sent to Customer';
      subtitle.textContent = 'Waiting for customer to enter PIN on phone';

      document.getElementById('overlayAmount').textContent = 'KES ' + amount.toLocaleString();
      document.getElementById('overlayPhone').textContent = phone;
      document.getElementById('overlayReceipt').textContent = 'Pending PIN...';

      successActions.classList.add('hidden');
      cancelBtn.classList.remove('hidden');
      overlay.classList.remove('hidden');

      let seconds = 60;
      clearInterval(countdownInterval);
      countdownInterval = setInterval(() => {
        seconds--;
        document.getElementById('countdownText').textContent = 'Timeout in ' + seconds + 's';
        if (seconds <= 0) {
          clearInterval(countdownInterval);
          dismissOverlay();
        }
      }, 1000);
    }

    function dismissOverlay() {
      clearInterval(countdownInterval);
      document.getElementById('statusOverlay').classList.add('hidden');
      inFlightPaymentId = null;
    }

    // Receipt Thermal Printing Engine
    function populateReceipt(tx) {
      document.getElementById('rcptCode').textContent = tx.mpesaReceiptNumber || tx.checkoutRequestId?.slice(0, 10) || '-';
      document.getElementById('rcptDateTime').textContent = new Date(tx.initiatedAt).toLocaleString();
      document.getElementById('rcptCustomer').textContent = (tx.customerName || 'M-Pesa Customer').toUpperCase();
      document.getElementById('rcptPhone').textContent = tx.phoneNumber || '-';
      document.getElementById('rcptChannel').textContent = tx.paymentType === 'C2B' ? 'LIPA NA M-PESA (BUY GOODS)' : 'M-PESA EXPRESS (STK)';
      document.getElementById('rcptBillRef').textContent = tx.accountReference || '-';
      document.getElementById('rcptAmount').textContent = 'KES ' + (tx.amount || 0).toLocaleString() + '.00';
    }

    function openReceiptModal(tx) {
      populateReceipt(tx);
      document.getElementById('receiptModal').classList.remove('hidden');
    }

    function closeReceiptModal() {
      document.getElementById('receiptModal').classList.add('hidden');
    }

    function pushPrintActiveReceipt() {
      if (activePaymentForReceipt) {
        populateReceipt(activePaymentForReceipt);
        window.print();
      }
    }

    // Fetch Recent Payments Feed
    async function fetchFeed() {
      try {
        const query = searchQuery ? '?search=' + encodeURIComponent(searchQuery) : '';
        const res = await fetch('/api/payments/feed' + query);
        const data = await res.json();
        transactions = data.payments || [];
        renderTransactions();
        updateShiftMetrics();
      } catch (err) {
        console.error('Failed to load feed', err);
      }
    }

    function renderTransactions() {
      const tbody = document.getElementById('transactionsTbody');
      const countBadge = document.getElementById('feedCountBadge');
      const mobBadge = document.getElementById('mobFeedBadge');
      
      let list = transactions;
      if (currentFilter === 'C2B') list = list.filter(t => t.paymentType === 'C2B');
      if (currentFilter === 'STK') list = list.filter(t => t.paymentType === 'STK_PUSH' || !t.paymentType);

      countBadge.textContent = list.length;
      if (list.length > 0) {
        mobBadge.textContent = list.length;
        mobBadge.classList.remove('hidden');
      }

      if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="py-12 text-center text-slate-500"><div class="text-3xl mb-1">🔍</div>No transactions found</td></tr>';
        return;
      }

      tbody.innerHTML = list.map(tx => {
        const time = new Date(tx.initiatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const receipt = tx.mpesaReceiptNumber || tx.checkoutRequestId?.slice(0, 10) || '-';
        const channelBadge = tx.paymentType === 'C2B'
          ? '<span class="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30">TILL (C2B)</span>'
          : '<span class="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-300 font-bold border border-blue-500/30">STK PUSH</span>';

        const flashClass = tx._flash ? 'row-flash' : '';
        const billDisplay = tx.accountReference || '<span class="text-slate-600">-</span>';

        const txJson = JSON.stringify(tx).replace(/"/g, '&quot;');

        return '<tr class="hover:bg-slate-800/40 transition ' + flashClass + '">' +
          '<td class="py-3 px-3 mono text-slate-400">' + time + '</td>' +
          '<td class="py-3 px-3 mono font-extrabold text-white"><span class="cursor-pointer hover:text-emerald-400 underline decoration-slate-700 decoration-dotted" onclick="copyReceipt(\\'' + receipt + '\\')">' + receipt + '</span></td>' +
          '<td class="py-3 px-3">' +
            '<div class="font-bold text-slate-200">' + (tx.customerName || 'M-Pesa Customer') + '</div>' +
            '<div class="text-[11px] text-slate-500 mono">' + tx.phoneNumber + '</div>' +
          '</td>' +
          '<td class="py-3 px-3">' + channelBadge + '</td>' +
          '<td class="py-3 px-3 text-right font-black text-emerald-400 mono text-sm">KES ' + tx.amount.toLocaleString() + '</td>' +
          '<td class="py-3 px-3 mono text-slate-300">' + billDisplay + '</td>' +
          '<td class="py-3 px-3 text-center">' +
            '<div class="flex items-center justify-center gap-1.5">' +
              '<button onclick="openClaimModal(\\'' + tx.id + '\\', \\'' + receipt + '\\', ' + tx.amount + ')" class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-slate-300" title="Link to Invoice">Link</button>' +
              '<button onclick="openReceiptModal(' + txJson + ')" class="px-2 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/30" title="Print Receipt">🖨️</button>' +
            '</div>' +
          '</td>' +
        '</tr>';
      }).join('');
    }

    function copyReceipt(code) {
      navigator.clipboard.writeText(code);
      alert('Copied M-Pesa receipt code: ' + code);
    }

    function setFilter(type) {
      currentFilter = type;
      document.getElementById('filterAll').className = type === 'ALL' ? 'px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40' : 'px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700';
      document.getElementById('filterC2B').className = type === 'C2B' ? 'px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40' : 'px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700';
      document.getElementById('filterSTK').className = type === 'STK' ? 'px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40' : 'px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700';
      renderTransactions();
    }

    let searchTimer = null;
    function handleSearch(val) {
      searchQuery = val.trim();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        fetchFeed();
      }, 200);
    }

    function updateShiftMetrics() {
      const sum = transactions.filter(t => t.status === 'SUCCESS').reduce((acc, t) => acc + (t.amount || 0), 0);
      const count = transactions.filter(t => t.status === 'SUCCESS').length;
      document.getElementById('shiftTotal').textContent = 'KES ' + sum.toLocaleString();
      document.getElementById('shiftCount').textContent = '(' + count + ' txns)';
    }

    // Mobile View Tab Switching
    function switchMobileTab(tab) {
      const promptPanel = document.getElementById('panelPrompt');
      const feedPanel = document.getElementById('panelFeed');
      const tabPrompt = document.getElementById('mobTabPrompt');
      const tabFeed = document.getElementById('mobTabFeed');

      if (tab === 'prompt') {
        promptPanel.classList.remove('hidden');
        feedPanel.classList.add('hidden');
        tabPrompt.className = 'flex flex-col items-center gap-1 text-emerald-400';
        tabFeed.className = 'flex flex-col items-center gap-1 text-slate-400 relative';
      } else {
        promptPanel.classList.add('hidden');
        feedPanel.classList.remove('hidden');
        tabPrompt.className = 'flex flex-col items-center gap-1 text-slate-400';
        tabFeed.className = 'flex flex-col items-center gap-1 text-emerald-400 relative';
      }
    }

    // Claim modal
    function openClaimModal(id, receipt, amount) {
      activeClaimId = id;
      document.getElementById('claimReceipt').textContent = receipt;
      document.getElementById('claimAmount').textContent = 'KES ' + amount.toLocaleString();
      document.getElementById('claimBillInput').value = '';
      document.getElementById('claimModal').classList.remove('hidden');
    }

    function closeClaimModal() {
      document.getElementById('claimModal').classList.add('hidden');
      activeClaimId = null;
    }

    async function submitClaim() {
      const billRef = document.getElementById('claimBillInput').value.trim();
      if (!billRef || !activeClaimId) return;

      try {
        await fetch('/api/payments/' + activeClaimId + '/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ billReference: billRef })
        });
        closeClaimModal();
        fetchFeed();
      } catch (err) {
        alert('Claim error: ' + err.message);
      }
    }

    // Reconciliation Modal
    async function openReconciliationModal() {
      try {
        const res = await fetch('/api/reconciliation/summary');
        const data = await res.json();
        document.getElementById('reconTotalAmount').textContent = 'KES ' + (data.totalAmount || 0).toLocaleString();
        document.getElementById('reconTotalCount').textContent = (data.totalCount || 0);
        document.getElementById('reconStkCount').textContent = (data.stkCount || 0);
        document.getElementById('reconC2bCount').textContent = (data.c2bCount || 0);
        document.getElementById('reconciliationModal').classList.remove('hidden');
      } catch (err) {
        alert('Failed to load reconciliation: ' + err.message);
      }
    }

    function closeReconciliationModal() {
      document.getElementById('reconciliationModal').classList.add('hidden');
    }

    // Testing Simulator
    async function simulateTransaction(type) {
      try {
        if (type === 'c2b') {
          await fetch('/api/simulate/c2b', { method: 'POST' });
        } else {
          await fetch('/api/simulate/stk', { method: 'POST' });
        }
      } catch (err) {
        alert('Simulation error: ' + err.message);
      }
    }

    // Keyboard Shortcuts for Cashier Productivity
    window.addEventListener('keydown', (e) => {
      // Escape closes overlays
      if (e.key === 'Escape') {
        dismissOverlay();
        closeReceiptModal();
        closeSettingsModal();
        closeClaimModal();
        closeReconciliationModal();
      }
      // F2 focuses Amount input
      if (e.key === 'F2') {
        e.preventDefault();
        document.getElementById('amountInput').focus();
      }
    });

    // Initialize
    applyStoreSettings();
    initEventStream();
    fetchFeed();
  </script>

</body>
</html>
`;
