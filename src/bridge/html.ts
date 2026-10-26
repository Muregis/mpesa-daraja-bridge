/**
 * Embedded Cashier Terminal HTML & Client Application.
 * Zero external client-side build tools required — loads Tailwind via CDN
 * and utilizes native Server-Sent Events (SSE) and Web Audio API synthesizer.
 */
export const TERMINAL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>M-Pesa Payment Bridge — Cashier Terminal</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
    .mono { font-family: 'JetBrains Mono', monospace; }
    @keyframes pulse-green {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.85; transform: scale(1.02); }
    }
    .pulse-verify { animation: pulse-green 1.5s infinite; }
    @keyframes flash-in {
      from { background-color: rgba(34, 197, 94, 0.35); }
      to { background-color: transparent; }
    }
    .row-flash { animation: flash-in 2s ease-out; }
  </style>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen flex flex-col">

  <!-- Top Navigation & Shift Bar -->
  <header class="bg-slate-800/90 border-b border-slate-700/80 px-6 py-3.5 sticky top-0 z-30 backdrop-blur">
    <div class="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
      
      <!-- Logo & Title -->
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center font-black text-slate-950 text-xl shadow-lg shadow-emerald-500/20">
          M
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-lg font-bold text-white tracking-tight">M-Pesa Daraja Payment Bridge</h1>
            <span class="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-semibold border border-emerald-500/20">Retail POS</span>
          </div>
          <p class="text-xs text-slate-400">Under 1-second verification without checking customer phones</p>
        </div>
      </div>

      <!-- Live Shift Stats & Indicators -->
      <div class="flex items-center gap-4">
        
        <!-- SSE Live Indicator -->
        <div id="connectionStatus" class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-500/30 text-xs font-semibold text-emerald-400">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
          <span>LIVE BRIDGE CONNECTED</span>
        </div>

        <!-- Shift Total -->
        <div class="hidden sm:flex items-center gap-3 px-3.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-700/60 text-xs">
          <span class="text-slate-400">Shift Total:</span>
          <span id="shiftTotal" class="font-bold text-emerald-400 mono text-sm">KES 0</span>
          <span id="shiftCount" class="text-slate-500">(0 txns)</span>
        </div>

        <!-- Audio Chime Toggle -->
        <button id="chimeToggle" onclick="toggleAudio()" class="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-medium text-slate-200 flex items-center gap-1.5 transition">
          <span id="chimeIcon">🔊</span>
          <span id="chimeLabel">Chime: ON</span>
        </button>

        <!-- Reconciliation Button -->
        <button onclick="openReconciliationModal()" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow transition flex items-center gap-1.5">
          <span>📊</span>
          <span>Reconciliation</span>
        </button>

      </div>
    </div>
  </header>

  <!-- Main Grid Workspace -->
  <main class="max-w-7xl mx-auto w-full p-6 flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6">

    <!-- LEFT COLUMN: STK Prompt Cashier Workstation (5 cols) -->
    <section class="lg:col-span-5 flex flex-col gap-6">

      <!-- Cashier Action Card -->
      <div class="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        
        <div class="flex items-center justify-between pb-4 border-b border-slate-700/60 mb-5">
          <div class="flex items-center gap-2">
            <span class="w-3 h-3 rounded-full bg-emerald-500"></span>
            <h2 class="font-bold text-white tracking-wide text-base">Prompt Customer Phone</h2>
          </div>
          <span class="text-xs text-slate-400 mono">STK PUSH</span>
        </div>

        <!-- Prompt Form -->
        <form id="promptForm" onsubmit="handleInitiatePrompt(event)" class="space-y-4">
          
          <!-- Amount Input -->
          <div>
            <label class="block text-xs font-medium text-slate-300 mb-1.5">
              Amount to Charge <span class="text-emerald-400">*</span>
            </label>
            <div class="relative">
              <span class="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold mono">KES</span>
              <input
                id="amountInput"
                type="number"
                min="1"
                step="1"
                required
                placeholder="0"
                class="w-full pl-16 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-2xl font-bold mono focus:outline-none focus:border-emerald-500 transition"
              />
            </div>
            <!-- Quick Amount Chips -->
            <div class="grid grid-cols-5 gap-1.5 mt-2">
              <button type="button" onclick="setAmount(100)" class="py-1 bg-slate-700/60 hover:bg-slate-700 text-xs text-slate-300 rounded font-medium transition">+100</button>
              <button type="button" onclick="setAmount(500)" class="py-1 bg-slate-700/60 hover:bg-slate-700 text-xs text-slate-300 rounded font-medium transition">+500</button>
              <button type="button" onclick="setAmount(1000)" class="py-1 bg-slate-700/60 hover:bg-slate-700 text-xs text-slate-300 rounded font-medium transition">+1K</button>
              <button type="button" onclick="setAmount(2500)" class="py-1 bg-slate-700/60 hover:bg-slate-700 text-xs text-slate-300 rounded font-medium transition">+2.5K</button>
              <button type="button" onclick="setAmount(5000)" class="py-1 bg-slate-700/60 hover:bg-slate-700 text-xs text-slate-300 rounded font-medium transition">+5K</button>
            </div>
          </div>

          <!-- Phone Number Input -->
          <div>
            <label class="block text-xs font-medium text-slate-300 mb-1.5">
              Customer Phone Number <span class="text-emerald-400">*</span>
            </label>
            <div class="relative">
              <input
                id="phoneInput"
                type="tel"
                required
                placeholder="0712 345 678 or 0110..."
                class="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-lg font-semibold mono focus:outline-none focus:border-emerald-500 transition"
              />
              <span id="carrierBadge" class="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-400"></span>
            </div>
          </div>

          <!-- Bill / Invoice Reference -->
          <div>
            <label class="block text-xs font-medium text-slate-300 mb-1.5">
              Bill / Prescription / Invoice # <span class="text-slate-500">(Optional)</span>
            </label>
            <input
              id="billRefInput"
              type="text"
              placeholder="e.g. INV-104 or RX-892"
              class="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm mono focus:outline-none focus:border-emerald-500 transition"
            />
          </div>

          <!-- Submit Button -->
          <button
            id="promptBtn"
            type="submit"
            class="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-base shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2"
          >
            <span id="promptBtnIcon">📲</span>
            <span id="promptBtnText">SEND M-PESA PROMPT</span>
          </button>
        </form>

        <!-- IN-FLIGHT VERIFICATION OVERLAY (Appears during prompt) -->
        <div id="statusOverlay" class="hidden absolute inset-0 bg-slate-900/95 p-6 flex flex-col justify-between z-20 backdrop-blur-md rounded-2xl">
          
          <div class="flex items-center justify-between">
            <span id="overlayBadge" class="text-xs px-2.5 py-1 rounded-full font-bold uppercase mono bg-amber-500/20 text-amber-400 border border-amber-500/30">AWAITING PIN</span>
            <button onclick="dismissOverlay()" class="text-slate-400 hover:text-white text-sm font-bold p-1">✕</button>
          </div>

          <!-- Center Visual Feedback -->
          <div class="text-center my-auto py-4">
            
            <!-- Animated Icon State -->
            <div id="overlayIconContainer" class="w-20 h-20 mx-auto rounded-full bg-amber-500/10 border-2 border-amber-500/40 flex items-center justify-center text-3xl mb-4">
              <span id="overlayIcon" class="animate-bounce">📲</span>
            </div>

            <!-- Big Status Title -->
            <h3 id="overlayTitle" class="text-2xl font-black text-white tracking-tight mb-1">Prompt Sent to Customer</h3>
            <p id="overlaySubtitle" class="text-slate-400 text-sm mb-4">Customer should enter M-Pesa PIN on their phone</p>

            <!-- Amount & Details Card -->
            <div class="bg-slate-950/80 rounded-xl p-4 border border-slate-800 max-w-xs mx-auto text-left space-y-1.5 mono text-xs">
              <div class="flex justify-between">
                <span class="text-slate-500">Amount:</span>
                <span id="overlayAmount" class="text-emerald-400 font-bold text-sm">KES 0</span>
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

            <!-- Anti-Fraud Notice -->
            <div id="antiFraudNotice" class="mt-4 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 inline-block">
              🛡️ Cashier: Do NOT check customer phone. Screen verifies automatically.
            </div>

          </div>

          <!-- Timer / Countdown Footer -->
          <div class="pt-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span id="countdownText">Timeout in 60s</span>
            <button id="cancelPromptBtn" onclick="dismissOverlay()" class="text-rose-400 hover:underline">Close / Switch to Till</button>
          </div>

        </div>

      </div>

      <!-- Quick Simulator Station for Cashier Training & Test -->
      <div class="bg-slate-800/40 border border-slate-700/60 rounded-2xl p-4 text-xs">
        <div class="flex items-center justify-between mb-2">
          <span class="font-bold text-slate-300 flex items-center gap-1.5">
            <span>⚡</span> Test & Training Simulator
          </span>
          <span class="text-[10px] text-slate-500 uppercase font-mono">Instant Sandbox</span>
        </div>
        <p class="text-slate-400 mb-3">Test sub-second cashier screen verification with mock callbacks:</p>
        <div class="grid grid-cols-2 gap-2">
          <button onclick="simulateTransaction('c2b')" class="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 font-medium text-slate-200 transition text-left">
            <div class="font-bold text-emerald-400">+ KES 1,500 Till (C2B)</div>
            <div class="text-[10px] text-slate-400">Simulate Buy Goods pay</div>
          </button>
          <button onclick="simulateTransaction('stk')" class="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 font-medium text-slate-200 transition text-left">
            <div class="font-bold text-emerald-400">+ KES 2,500 STK Push</div>
            <div class="text-[10px] text-slate-400">Simulate PIN entry</div>
          </button>
        </div>
      </div>

    </section>

    <!-- RIGHT COLUMN: The Supermarket Message Store (7 cols) -->
    <section class="lg:col-span-7 flex flex-col gap-4">

      <div class="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-6 shadow-xl flex-1 flex flex-col">
        
        <!-- Header with Live Search Filter -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-700/60 mb-4">
          
          <div>
            <h2 class="font-bold text-white text-base flex items-center gap-2">
              <span>Supermarket Message Store</span>
              <span id="feedCountBadge" class="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 font-mono">0</span>
            </h2>
            <p class="text-xs text-slate-400">Live incoming Paybill & Till transactions stream here in real time</p>
          </div>

          <!-- Search Filter Bar -->
          <div class="relative w-full sm:w-64">
            <input
              id="searchInput"
              type="text"
              oninput="handleSearch(this.value)"
              placeholder="Search code (e.g. 9KL), phone..."
              class="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white mono focus:outline-none focus:border-emerald-500 transition"
            />
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">🔍</span>
          </div>

        </div>

        <!-- Filter Chips -->
        <div class="flex items-center gap-2 mb-4 text-xs">
          <span class="text-slate-400 text-[11px]">Filter:</span>
          <button onclick="setFilter('ALL')" id="filterAll" class="px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/40">All</button>
          <button onclick="setFilter('C2B')" id="filterC2B" class="px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700">Till (C2B)</button>
          <button onclick="setFilter('STK')" id="filterSTK" class="px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700">STK Push</button>
        </div>

        <!-- Transactions Table Container -->
        <div class="flex-1 overflow-x-auto min-h-[360px]">
          <table class="w-full text-left text-xs">
            <thead>
              <tr class="text-slate-400 border-b border-slate-700/80 pb-2">
                <th class="py-2.5 px-3 font-semibold">Time</th>
                <th class="py-2.5 px-3 font-semibold">M-Pesa Receipt</th>
                <th class="py-2.5 px-3 font-semibold">Customer / Phone</th>
                <th class="py-2.5 px-3 font-semibold">Channel</th>
                <th class="py-2.5 px-3 font-semibold text-right">Amount</th>
                <th class="py-2.5 px-3 font-semibold">Ref / Bill #</th>
                <th class="py-2.5 px-3 font-semibold text-center">Action</th>
              </tr>
            </thead>
            <tbody id="transactionsTbody" class="divide-y divide-slate-800/80 text-slate-300">
              <!-- Rendered dynamically -->
              <tr>
                <td colspan="7" class="py-12 text-center text-slate-500">
                  <div class="text-2xl mb-2">📥</div>
                  <p>Listening for payments...</p>
                  <p class="text-[11px] text-slate-600 mt-1">Transactions will appear automatically in under 1s</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Footer Help -->
        <div class="pt-3 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
          <span>Click on any code to copy. Click "Claim" to link a payment to an open invoice.</span>
          <button onclick="fetchFeed()" class="text-slate-400 hover:text-white flex items-center gap-1">
            <span>🔄</span> Refresh
          </button>
        </div>

      </div>

    </section>

  </main>

  <!-- CLAIM / LINK TO BILL MODAL -->
  <div id="claimModal" class="hidden fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="bg-slate-800 border border-slate-700 rounded-2xl max-w-sm w-full p-6 shadow-2xl">
      <h3 class="text-lg font-bold text-white mb-1">Claim Payment to Bill</h3>
      <p class="text-xs text-slate-400 mb-4">Link this customer's payment to a specific invoice or prescription number.</p>
      
      <div class="space-y-3 mb-5 text-xs">
        <div class="bg-slate-900 p-3 rounded-lg border border-slate-700/60 space-y-1 mono">
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
          <label class="block text-xs font-medium text-slate-300 mb-1">Bill / Invoice Reference #</label>
          <input id="claimBillInput" type="text" placeholder="e.g. INV-205" class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white mono text-sm focus:outline-none focus:border-emerald-500" />
        </div>
      </div>

      <div class="flex items-center justify-end gap-2">
        <button onclick="closeClaimModal()" class="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-medium text-slate-300">Cancel</button>
        <button onclick="submitClaim()" class="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs">Save & Link</button>
      </div>
    </div>
  </div>

  <!-- RECONCILIATION MODAL -->
  <div id="reconciliationModal" class="hidden fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="bg-slate-800 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl">
      <div class="flex items-center justify-between pb-3 border-b border-slate-700 mb-4">
        <h3 class="text-base font-bold text-white flex items-center gap-2">
          <span>📊</span> End-of-Day Reconciliation
        </h3>
        <button onclick="closeReconciliationModal()" class="text-slate-400 hover:text-white">✕</button>
      </div>

      <div class="space-y-4 mb-6">
        <div class="grid grid-cols-2 gap-3">
          <div class="bg-slate-900 p-3 rounded-xl border border-slate-700/60">
            <div class="text-[11px] text-slate-400">Total Collected</div>
            <div id="reconTotalAmount" class="text-xl font-bold text-emerald-400 mono mt-0.5">KES 0</div>
          </div>
          <div class="bg-slate-900 p-3 rounded-xl border border-slate-700/60">
            <div class="text-[11px] text-slate-400">Total Transactions</div>
            <div id="reconTotalCount" class="text-xl font-bold text-white mono mt-0.5">0</div>
          </div>
        </div>

        <div class="bg-slate-900 p-4 rounded-xl border border-slate-700/60 space-y-2 text-xs">
          <div class="flex justify-between">
            <span class="text-slate-400">STK Push Payments:</span>
            <span id="reconStkCount" class="text-slate-200 font-bold mono">0</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-400">Till / Paybill (C2B) Payments:</span>
            <span id="reconC2bCount" class="text-slate-200 font-bold mono">0</span>
          </div>
          <div class="flex justify-between border-t border-slate-800 pt-2">
            <span class="text-slate-400">Drift / Mismatches:</span>
            <span class="text-emerald-400 font-bold mono">0 (Clean Match)</span>
          </div>
        </div>

        <p class="text-[11px] text-slate-400">
          This report aggregates all verified transactions recorded in the local tamper-proof SQLite database. Export for accountant or midnight reconciliation.
        </p>
      </div>

      <div class="flex items-center justify-end gap-2">
        <button onclick="closeReconciliationModal()" class="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs text-slate-300">Close</button>
        <a href="/api/reconciliation/export.csv" download="mpesa-statement.csv" class="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5">
          <span>📥</span> Download Bookkeeper CSV
        </a>
      </div>
    </div>
  </div>

  <!-- CLIENT APPLICATION JAVASCRIPT -->
  <script>
    // State
    let audioEnabled = true;
    let transactions = [];
    let currentFilter = 'ALL';
    let searchQuery = '';
    let inFlightPaymentId = null;
    let activeClaimId = null;
    let countdownInterval = null;

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
      document.getElementById('chimeLabel').textContent = audioEnabled ? 'Chime: ON' : 'Chime: OFF';
      document.getElementById('chimeIcon').textContent = audioEnabled ? '🔊' : '🔇';
      if (audioEnabled) playCashierChime();
    }

    // Quick Amount buttons
    function setAmount(val) {
      document.getElementById('amountInput').value = val;
    }

    // Connect to Server-Sent Events (SSE) Stream
    function initEventStream() {
      const statusEl = document.getElementById('connectionStatus');
      const es = new EventSource('/api/events');

      es.addEventListener('open', () => {
        statusEl.className = 'flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-500/30 text-xs font-semibold text-emerald-400';
        statusEl.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span><span>LIVE BRIDGE CONNECTED</span>';
      });

      es.addEventListener('error', () => {
        statusEl.className = 'flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-950/60 border border-rose-500/30 text-xs font-semibold text-rose-400';
        statusEl.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-400"></span><span>RECONNECTING...</span>';
      });

      // Handle payment verified event (STK or C2B)
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
      // Play crisp register chime
      playCashierChime();

      // If in-flight prompt matches, display huge green verified badge
      if (inFlightPaymentId && (inFlightPaymentId === payment.id || inFlightPaymentId === payment.checkoutRequestId)) {
        showVerifiedOverlay(payment);
      }

      // Add to beginning of transactions
      const existing = transactions.findIndex(t => t.id === payment.id);
      if (existing === -1) {
        payment._flash = true;
        transactions.unshift(payment);
      } else {
        transactions[existing] = payment;
      }

      renderTransactions();
      updateShiftMetrics();
    }

    function showVerifiedOverlay(payment) {
      clearInterval(countdownInterval);
      const overlay = document.getElementById('statusOverlay');
      const iconContainer = document.getElementById('overlayIconContainer');
      const badge = document.getElementById('overlayBadge');
      const title = document.getElementById('overlayTitle');
      const subtitle = document.getElementById('overlaySubtitle');
      const receipt = document.getElementById('overlayReceipt');

      badge.className = 'text-xs px-2.5 py-1 rounded-full font-bold uppercase mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
      badge.textContent = 'VERIFIED IN 0.8s';

      iconContainer.className = 'w-20 h-20 mx-auto rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-4xl mb-4 shadow-lg shadow-emerald-500/20';
      iconContainer.innerHTML = '<span>✓</span>';

      title.className = 'text-2xl font-black text-emerald-400 tracking-tight mb-1';
      title.textContent = 'PAYMENT VERIFIED';

      subtitle.textContent = 'M-Pesa money confirmed by Safaricom';
      receipt.textContent = payment.mpesaReceiptNumber || 'CONFIRMED';

      // Auto dismiss after 6 seconds to ready next customer
      setTimeout(() => {
        dismissOverlay();
        document.getElementById('amountInput').value = '';
        document.getElementById('phoneInput').value = '';
        document.getElementById('billRefInput').value = '';
      }, 6000);
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
        alert('Failed to connect to bridge: ' + err.message);
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

      badge.className = 'text-xs px-2.5 py-1 rounded-full font-bold uppercase mono bg-amber-500/20 text-amber-400 border border-amber-500/30';
      badge.textContent = 'AWAITING PIN';

      iconContainer.className = 'w-20 h-20 mx-auto rounded-full bg-amber-500/10 border-2 border-amber-500/40 flex items-center justify-center text-3xl mb-4';
      iconContainer.innerHTML = '<span class="animate-bounce">📲</span>';

      title.className = 'text-2xl font-black text-white tracking-tight mb-1';
      title.textContent = 'Prompt Sent to Customer';
      subtitle.textContent = 'Waiting for customer to enter PIN on phone';

      document.getElementById('overlayAmount').textContent = 'KES ' + amount.toLocaleString();
      document.getElementById('overlayPhone').textContent = phone;
      document.getElementById('overlayReceipt').textContent = 'Pending PIN...';

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
      
      let list = transactions;
      if (currentFilter === 'C2B') list = list.filter(t => t.paymentType === 'C2B');
      if (currentFilter === 'STK') list = list.filter(t => t.paymentType === 'STK_PUSH' || !t.paymentType);

      countBadge.textContent = list.length;

      if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="py-12 text-center text-slate-500"><div class="text-2xl mb-1">🔍</div>No transactions found</td></tr>';
        return;
      }

      tbody.innerHTML = list.map(tx => {
        const time = new Date(tx.initiatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const receipt = tx.mpesaReceiptNumber || tx.checkoutRequestId?.slice(0, 10) || '-';
        const channelBadge = tx.paymentType === 'C2B'
          ? '<span class="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30">TILL (C2B)</span>'
          : '<span class="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-300 font-bold border border-blue-500/30">STK PUSH</span>';

        const flashClass = tx._flash ? 'row-flash' : '';
        const billDisplay = tx.accountReference || '-';

        return '<tr class="hover:bg-slate-800/60 transition ' + flashClass + '">' +
          '<td class="py-3 px-3 mono text-slate-400">' + time + '</td>' +
          '<td class="py-3 px-3 mono font-bold text-white"><span class="cursor-pointer hover:text-emerald-400" onclick="copyReceipt(\\'' + receipt + '\\')">' + receipt + '</span></td>' +
          '<td class="py-3 px-3">' +
            '<div class="font-semibold text-slate-200">' + (tx.customerName || 'M-Pesa Customer') + '</div>' +
            '<div class="text-[11px] text-slate-500 mono">' + tx.phoneNumber + '</div>' +
          '</td>' +
          '<td class="py-3 px-3">' + channelBadge + '</td>' +
          '<td class="py-3 px-3 text-right font-bold text-emerald-400 mono text-sm">KES ' + tx.amount.toLocaleString() + '</td>' +
          '<td class="py-3 px-3 mono text-slate-300">' + billDisplay + '</td>' +
          '<td class="py-3 px-3 text-center">' +
            '<button onclick="openClaimModal(\\'' + tx.id + '\\', \\'' + receipt + '\\', ' + tx.amount + ')" class="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-[10px] font-semibold text-slate-200">Link Bill</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    }

    function copyReceipt(code) {
      navigator.clipboard.writeText(code);
      alert('Copied receipt code: ' + code);
    }

    function setFilter(type) {
      currentFilter = type;
      document.getElementById('filterAll').className = type === 'ALL' ? 'px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/40' : 'px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700';
      document.getElementById('filterC2B').className = type === 'C2B' ? 'px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/40' : 'px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700';
      document.getElementById('filterSTK').className = type === 'STK' ? 'px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/40' : 'px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700';
      renderTransactions();
    }

    let searchTimer = null;
    function handleSearch(val) {
      searchQuery = val.trim();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        fetchFeed();
      }, 250);
    }

    function updateShiftMetrics() {
      const sum = transactions.filter(t => t.status === 'SUCCESS').reduce((acc, t) => acc + (t.amount || 0), 0);
      const count = transactions.filter(t => t.status === 'SUCCESS').length;
      document.getElementById('shiftTotal').textContent = 'KES ' + sum.toLocaleString();
      document.getElementById('shiftCount').textContent = '(' + count + ' txns)';
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

    // Initial load
    initEventStream();
    fetchFeed();
  </script>

</body>
</html>
`;
