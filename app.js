// Contract Whist Tracker
// Scoring: +3 + bid if exact; -|actual - bid| if missed
// Trumps cycle: ♠ ♥ ♣ ♦ NT
// Dealer rotates: round R dealer = (firstDealer + R) % N
// Bid order: player to LEFT of dealer first; dealer LAST and is constrained.

const SUITS = [
  { sym: '♠', name: 'Spades', cls: 'suit-black' },
  { sym: '♥', name: 'Hearts', cls: 'suit-red' },
  { sym: '♣', name: 'Clubs', cls: 'suit-black' },
  { sym: '♦', name: 'Diamonds', cls: 'suit-red' },
  { sym: 'NT', name: 'No Trump', cls: 'suit-nt' },
];

const STORAGE_KEY = 'whist_history_v1';
const ACTIVE_KEY = 'whist_active_v2';
const STORE = window.localStorage;
// Migrate any old sessionStorage data on first load
(function migrate() {
  try {
    const ss = window.sessionStorage;
    for (const k of [STORAGE_KEY, ACTIVE_KEY]) {
      if (ss.getItem(k) && !STORE.getItem(k)) STORE.setItem(k, ss.getItem(k));
      ss.removeItem(k);
    }
  } catch {}
})();

const $ = (id) => document.getElementById(id);

let state = null;
let chartInstance = null;
let setupSelectedStarter = 'random';
let timerInterval = null;
let viewingShared = false; // true when summary is loaded from a shared URL

// -------- Setup --------
function maxCardsFor(players) { return Math.floor(52 / players); }

function renderPlayerNames() {
  const n = parseInt($('setup-players').value, 10) || 4;
  const wrap = $('setup-names');
  wrap.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const lbl = document.createElement('label');
    lbl.innerHTML = `Seat ${i + 1} <input type="text" data-player="${i}" value="Player ${i + 1}" />`;
    wrap.appendChild(lbl);
    lbl.querySelector('input').addEventListener('input', renderStarterButtons);
  }
  const maxC = maxCardsFor(n);
  const startInp = $('setup-start');
  startInp.max = maxC;
  if (!startInp.dataset.userSet || parseInt(startInp.value, 10) > maxC) startInp.value = maxC;
  $('setup-max-note').textContent = `Max for ${n} players: ${maxC}`;
  if (setupSelectedStarter !== 'random' && setupSelectedStarter >= n) setupSelectedStarter = 'random';
  renderStarterButtons();
}

function getSetupNames() {
  const names = [];
  document.querySelectorAll('#setup-names input').forEach((inp) => {
    names.push((inp.value || `Player ${parseInt(inp.dataset.player) + 1}`).trim());
  });
  return names;
}

function renderStarterButtons() {
  const n = parseInt($('setup-players').value, 10) || 4;
  const names = getSetupNames();
  const wrap = $('starter-buttons');
  wrap.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'starter-btn' + (setupSelectedStarter === i ? ' selected' : '');
    b.textContent = names[i] || `Player ${i + 1}`;
    b.addEventListener('click', () => { setupSelectedStarter = i; renderStarterButtons(); });
    wrap.appendChild(b);
  }
  const r = document.createElement('button');
  r.type = 'button';
  r.className = 'starter-btn random' + (setupSelectedStarter === 'random' ? ' selected' : '');
  r.textContent = '🎲 Random';
  r.addEventListener('click', () => { setupSelectedStarter = 'random'; renderStarterButtons(); });
  wrap.appendChild(r);
}

function buildRoundsList(start, dir) {
  const rounds = [];
  for (let n = start; n >= 1; n--) rounds.push(n);
  if (dir === 'updown') for (let n = 2; n <= start; n++) rounds.push(n);
  return rounds;
}

function startGame() {
  const players = getSetupNames();
  const start = parseInt($('setup-start').value, 10);
  const dir = $('setup-direction').value;
  const rounds = buildRoundsList(start, dir);
  let firstDealer = setupSelectedStarter;
  if (firstDealer === 'random') firstDealer = Math.floor(Math.random() * players.length);

  const now = Date.now();
  state = {
    id: now,
    startedAt: new Date(now).toISOString(),
    players,
    startCards: start,
    direction: dir,
    rounds,
    firstDealer,
    currentRound: 0,
    phase: 'bidding',
    history: [],
    pendingBids: players.map(() => null),
    pendingActuals: players.map(() => null),
    roundStartedAt: now,
    roundDurations: [], // ms for each completed round (close-of-score to close-of-score)
  };
  saveActive();
  showView('game');
  renderGame();
}

// -------- Game --------
function trumpFor(roundIdx) { return SUITS[roundIdx % SUITS.length]; }
function dealerForRound(roundIdx) { return (state.firstDealer + roundIdx) % state.players.length; }

function bidOrderForRound(roundIdx) {
  const N = state.players.length;
  const dealer = dealerForRound(roundIdx);
  const order = [];
  for (let i = 1; i <= N; i++) order.push((dealer + i) % N); // dealer+1 first, dealer last
  return order;
}

function positionRelativeToDealer(playerIdx, dealerIdx, N) {
  // 0 = dealer, 1 = player to dealer's left (first to bid), ..., N-1 = player to dealer's right (bids just before dealer)
  return (playerIdx - dealerIdx + N) % N;
}

function totals() {
  const t = state.players.map(() => 0);
  for (const r of state.history) for (let i = 0; i < t.length; i++) t[i] += r.deltas[i];
  return t;
}

function renderGame() {
  const idx = state.currentRound;
  const total = state.rounds.length;
  $('round-current').textContent = idx + 1;
  $('round-total').textContent = total;
  const cards = state.rounds[idx];
  $('card-count').textContent = cards;
  const trump = trumpFor(idx);
  const tc = $('trump-card');
  tc.textContent = trump.sym;
  tc.className = trump.cls;
  const dealerIdx = dealerForRound(idx);
  $('dealer-name').textContent = state.players[dealerIdx];

  const table = $('game-table');

  // Header row
  let header = '<tr><th class="round-cell">Round</th>';
  state.players.forEach((p, i) => {
    const isDealer = i === dealerIdx;
    header += `<th class="${isDealer ? 'dealer-col' : ''}">${escapeHtml(p)}${isDealer ? '<div class="dealer-pill">DEALER</div>' : ''}</th>`;
  });
  header += '</tr>';

  let html = '<thead>' + header + '</thead><tbody>';

  // Historical rounds
  state.history.forEach((r, ri) => {
    const rTrump = SUITS.find(s => s.name === r.trump);
    const rDealer = dealerForRound(ri);
    const bidSum = r.bids.reduce((a, b) => a + b, 0);
    const diff = bidSum - r.cards;
    const diffCls = diff > 0 ? 'over' : (diff < 0 ? 'under' : '');
    const diffStr = diff === 0 ? '=cards' : (diff > 0 ? `+${diff}` : `${diff}`);
    html += `<tr><td class="round-cell">
      <div><span class="cards-num">${r.cards}</span><span class="trump-sym ${rTrump.cls}">${rTrump.sym}</span></div>
      <small>R${ri + 1}</small>
      <span class="round-bidsum ${diffCls}">bids ${bidSum} (${diffStr})</span>
    </td>`;
    state.players.forEach((p, pi) => {
      const ok = r.bids[pi] === r.actuals[pi];
      const isDealer = pi === rDealer;
      const dStr = (r.deltas[pi] >= 0 ? '+' : '') + r.deltas[pi];
      html += `<td class="${isDealer ? 'dealer-col' : ''}">
        <div class="cell-stack">
          <span class="bid-with-delta">
            <span class="bid-result ${ok ? 'bid-correct' : 'bid-miss'}">${r.bids[pi]}</span><sup class="delta-sup ${r.deltas[pi] >= 0 ? 'pos' : 'neg'}">${dStr}</sup>
          </span>
          <span class="cell-total">${r.totals[pi]}</span>
        </div>
      </td>`;
    });
    html += '</tr>';
  });

  // Current round
  const curTotals = totals();
  const curBidSum = state.pendingBids.reduce((a, b) => a + (b ?? 0), 0);
  const curDiff = curBidSum - cards;
  const curDiffCls = curDiff > 0 ? 'over' : (curDiff < 0 ? 'under' : 'even');
  const curDiffStr = curDiff === 0 ? '=cards' : (curDiff > 0 ? `+${curDiff}` : `${curDiff}`);
  html += `<tr class="current-row"><td class="round-cell">
    <div><span class="cards-num">${cards}</span><span class="trump-sym ${trump.cls}">${trump.sym}</span></div>
    <small>R${idx + 1} (now)</small>
    <span class="round-bidsum ${curDiffCls}">bids ${curBidSum} (${curDiffStr})</span>
  </td>`;
  state.players.forEach((p, pi) => {
    const isDealer = pi === dealerIdx;
    let cell = '';
    if (state.phase === 'bidding') {
      const b = state.pendingBids[pi];
      const bVal = b == null ? '' : b;
      cell = `<div class="cell-stack">
        <input type="number" inputmode="numeric" pattern="[0-9]*" class="cell-input" min="0" max="${cards}"
          placeholder="0" value="${bVal}" data-bid="${pi}" />
        <span class="cell-total">${curTotals[pi]}</span>
      </div>`;
    } else {
      const b = state.pendingBids[pi] ?? 0;
      const a = state.pendingActuals[pi];
      const aVal = a == null ? '' : a;
      const aNum = a ?? 0;
      const delta = scoreFor(b, aNum);
      const ok = b === aNum && a != null;
      const dStr = (delta >= 0 ? '+' : '') + delta;
      cell = `<div class="cell-stack">
        <span class="bid-with-delta">
          <span class="bid-result ${ok ? 'bid-correct' : 'bid-miss'}">${b}</span><sup class="delta-sup ${delta >= 0 ? 'pos' : 'neg'}" data-sup="${pi}">${a == null ? '' : dStr}</sup>
        </span>
        <input type="number" inputmode="numeric" pattern="[0-9]*" class="cell-input" min="0" max="${cards}"
          placeholder="0" value="${aVal}" data-actual="${pi}" />
        <span class="cell-total" data-total="${pi}">${a == null ? curTotals[pi] : curTotals[pi] + delta}</span>
      </div>`;
    }
    html += `<td class="${isDealer ? 'dealer-col' : ''}">${cell}</td>`;
  });
  html += '</tr></tbody>';

  // Sticky footer = repeat of header
  html += '<tfoot>' + header.replace(/<th /g, '<td ').replace(/<\/th>/g, '</td>') + '</tfoot>';

  table.innerHTML = html;

  // Bid summary in header
  updateHeaderSummary();

  // Bind inputs
  table.querySelectorAll('input[data-bid]').forEach((inp) => {
    inp.addEventListener('focus', () => { selectAllValue(inp); updateBidWarning(inp); });
    inp.addEventListener('click', () => selectAllValue(inp));
    inp.addEventListener('input', () => {
      const raw = inp.value.trim();
      let v = raw === '' ? null : clampInt(raw, 0, cards);
      // Hard cap: prevent typing above max
      if (v != null && v > cards) { v = cards; inp.value = cards; }
      state.pendingBids[+inp.dataset.bid] = v;
      updateBidWarning(inp);
      updateRoundBidSum();
      saveActive();
    });
    inp.addEventListener('blur', () => updateBidWarning(null));
  });
  table.querySelectorAll('input[data-actual]').forEach((inp) => {
    inp.addEventListener('focus', () => selectAllValue(inp));
    inp.addEventListener('click', () => selectAllValue(inp));
    inp.addEventListener('input', () => {
      const pi = +inp.dataset.actual;
      const raw = inp.value.trim();
      let v = raw === '' ? null : clampInt(raw, 0, cards);
      if (v != null && v > cards) { v = cards; inp.value = cards; }
      state.pendingActuals[pi] = v;
      updateActualCell(pi);
      updateBidWarning(null);
      saveActive();
    });
  });

  $('lock-bids').classList.toggle('hidden', state.phase !== 'bidding');
  $('commit-round').classList.toggle('hidden', state.phase !== 'playing');
  updateBidWarning(null);
  startTimer();
}

function updateRoundBidSum() {
  const tbl = $('game-table');
  const cell = tbl.querySelector('.current-row .round-cell .round-bidsum');
  if (!cell) return;
  const cards = state.rounds[state.currentRound];
  const sum = state.pendingBids.reduce((a, b) => a + (b ?? 0), 0);
  const diff = sum - cards;
  const diffCls = diff > 0 ? 'over' : (diff < 0 ? 'under' : 'even');
  const diffStr = diff === 0 ? '=cards' : (diff > 0 ? `+${diff}` : `${diff}`);
  cell.className = 'round-bidsum ' + diffCls;
  cell.textContent = `bids ${sum} (${diffStr})`;
  updateHeaderSummary();
}

function updateHeaderSummary() {
  const cards = state.rounds[state.currentRound];
  const bs = $('bid-summary');
  if (state.phase === 'bidding') {
    const sum = state.pendingBids.reduce((a, b) => a + (b ?? 0), 0);
    const diff = sum - cards;
    const cls = diff > 0 ? 'over' : (diff < 0 ? 'under' : 'even');
    const label = diff === 0 ? '=cards' : (diff > 0 ? `over by ${diff}` : `under by ${-diff}`);
    bs.className = 'bid-summary ' + cls;
    bs.textContent = `Bids: ${sum} (${label})`;
  } else {
    const sum = state.pendingActuals.reduce((a, b) => a + (b ?? 0), 0);
    bs.className = 'bid-summary';
    bs.textContent = `Tricks: ${sum}/${cards}`;
  }
}

// iOS Safari ignores .select() on type=number, so switch to text briefly to select.
function selectAllValue(inp) {
  try {
    const v = inp.value;
    if (v === '' || v == null) return;
    const orig = inp.type;
    if (orig === 'number') inp.type = 'text';
    inp.setSelectionRange(0, String(v).length);
    if (orig === 'number') inp.type = orig;
  } catch {
    try { inp.select(); } catch {}
  }
}

function scoreFor(bid, actual) {
  if (bid === actual) return 3 + bid;
  return -Math.abs(actual - bid);
}

function updateActualCell(pi) {
  const tbl = $('game-table');
  const supEl = tbl.querySelector(`sup[data-sup="${pi}"]`);
  const totEl = tbl.querySelector(`span[data-total="${pi}"]`);
  const bidEl = tbl.querySelectorAll('.current-row .bid-result')[pi];
  if (!supEl || !totEl || !bidEl) return;
  const b = state.pendingBids[pi] ?? 0;
  const a = state.pendingActuals[pi];
  const curTotals = totals();
  if (a == null) {
    supEl.textContent = '';
    totEl.textContent = curTotals[pi];
    bidEl.classList.remove('bid-correct');
    bidEl.classList.add('bid-miss');
    return;
  }
  const delta = scoreFor(b, a);
  const ok = b === a;
  bidEl.classList.toggle('bid-correct', ok);
  bidEl.classList.toggle('bid-miss', !ok);
  supEl.textContent = (delta >= 0 ? '+' : '') + delta;
  supEl.classList.toggle('pos', delta >= 0);
  supEl.classList.toggle('neg', delta < 0);
  totEl.textContent = curTotals[pi] + delta;
  updateHeaderSummary();
}

function updateBidWarning(focusedInput) {
  const warn = $('bid-warning');
  if (state.phase !== 'bidding') {
    const cards = state.rounds[state.currentRound];
    const sum = state.pendingActuals.reduce((a, b) => a + (b ?? 0), 0);
    warn.className = 'bid-warning info';
    warn.textContent = `Tricks entered: ${sum} / ${cards}`;
    return;
  }
  const cards = state.rounds[state.currentRound];
  const order = bidOrderForRound(state.currentRound);
  const lastBidderIdx = order[order.length - 1];

  if (focusedInput && +focusedInput.dataset.bid === lastBidderIdx) {
    const otherSum = state.pendingBids.reduce((acc, b, i) => i === lastBidderIdx ? acc : acc + (b ?? 0), 0);
    const forbidden = cards - otherSum;
    const cur = state.pendingBids[lastBidderIdx];
    if (cur != null && cur === forbidden) {
      warn.className = 'bid-warning';
      warn.textContent = `⚠️ Dealer (${state.players[lastBidderIdx]}) cannot bid ${forbidden} — total bids would equal cards (${cards}).`;
    } else if (forbidden >= 0 && forbidden <= cards) {
      warn.className = 'bid-warning info';
      warn.textContent = `Others bid ${otherSum}. Dealer cannot bid ${forbidden} (would total ${cards}).`;
    } else {
      warn.className = 'bid-warning info';
      warn.textContent = `Others bid ${otherSum} — dealer can bid anything 0–${cards}.`;
    }
  } else {
    warn.className = 'bid-warning info';
    warn.textContent = '';
  }
}

// -------- Timer --------
function startTimer() {
  stopTimer();
  if (!state.roundStartedAt) state.roundStartedAt = Date.now();
  const el = $('round-timer');
  function tick() {
    const ms = Date.now() - state.roundStartedAt;
    el.textContent = '⏱ ' + formatDuration(ms);
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}
function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }
function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  return `${m}:${String(s % 60).padStart(2,'0')}`;
}

// -------- Lock / Commit / Undo --------
function lockBids() {
  const cards = state.rounds[state.currentRound];
  state.pendingBids = state.pendingBids.map(b => b == null ? 0 : Math.min(b, cards));
  const order = bidOrderForRound(state.currentRound);
  const lastBidderIdx = order[order.length - 1];
  const sum = state.pendingBids.reduce((a, b) => a + b, 0);
  if (sum === cards) {
    if (!confirm(`Total bids equal cards (${cards}). Dealer (${state.players[lastBidderIdx]}) shouldn't be allowed this. Continue anyway?`)) return;
  }
  state.phase = 'playing';
  state.pendingActuals = state.players.map(() => null);
  saveActive();
  renderGame();
}

function commitRound() {
  const cards = state.rounds[state.currentRound];
  state.pendingActuals = state.pendingActuals.map(a => a == null ? 0 : Math.min(a, cards));
  const sum = state.pendingActuals.reduce((a, b) => a + b, 0);
  if (sum !== cards) {
    if (!confirm(`Tricks won total ${sum} but there are ${cards} cards. Save anyway?`)) return;
  }
  const deltas = state.pendingBids.map((b, i) => scoreFor(b, state.pendingActuals[i]));
  const prev = state.history.length ? state.history[state.history.length - 1].totals : state.players.map(() => 0);
  const newTotals = prev.map((t, i) => t + deltas[i]);
  const now = Date.now();
  const duration = state.roundStartedAt ? (now - state.roundStartedAt) : 0;
  state.roundDurations.push(duration);
  state.history.push({
    cards,
    trump: trumpFor(state.currentRound).name,
    trumpSym: trumpFor(state.currentRound).sym,
    bids: [...state.pendingBids],
    actuals: [...state.pendingActuals],
    deltas,
    totals: newTotals,
    durationMs: duration,
  });
  state.currentRound += 1;
  state.phase = 'bidding';
  state.pendingBids = state.players.map(() => null);
  state.pendingActuals = state.players.map(() => null);
  state.roundStartedAt = now; // next round timer starts from "scored"
  saveActive();
  if (state.currentRound >= state.rounds.length) {
    finishGame();
  } else {
    renderGame();
  }
}

function undoLastRound() {
  if (state.phase === 'playing') {
    state.phase = 'bidding';
    saveActive();
    renderGame();
    return;
  }
  if (state.history.length === 0) return;
  if (!confirm('Undo last completed round?')) return;
  const last = state.history.pop();
  state.roundDurations.pop();
  state.currentRound -= 1;
  state.pendingBids = [...last.bids];
  state.pendingActuals = [...last.actuals];
  state.phase = 'bidding';
  state.roundStartedAt = Date.now();
  saveActive();
  renderGame();
}

// -------- Quick entry modal --------
let modalCtx = null;

function openQuickEntry() {
  if (state.phase !== 'bidding') {
    alert('Quick entry is only for bidding. Use the table to score tricks.');
    return;
  }
  // Order: player to the LEFT of dealer first → dealer last
  const order = bidOrderForRound(state.currentRound);
  modalCtx = { order, step: 0 };
  $('modal-backdrop').classList.remove('hidden');
  renderModal();
}

function closeModal() {
  $('modal-backdrop').classList.add('hidden');
  modalCtx = null;
  renderGame();
}

function renderModal() {
  if (!modalCtx) return;
  const { order, step } = modalCtx;
  const cards = state.rounds[state.currentRound];
  const dealerIdx = dealerForRound(state.currentRound);
  const N = state.players.length;
  const playerIdx = order[step];
  const isLast = step === order.length - 1;

  $('modal-title').textContent = `Round ${state.currentRound + 1} bids · ${cards} cards · ${trumpFor(state.currentRound).sym} trump`;
  $('modal-sub').textContent = `Bid ${step + 1} of ${order.length}`;
  $('modal-player').textContent = state.players[playerIdx];
  const pos = positionRelativeToDealer(playerIdx, dealerIdx, N);
  let posLabel;
  if (pos === 0) posLabel = 'DEALER (bids last)';
  else if (pos === 1) posLabel = '1st to bid · left of dealer';
  else if (pos === N - 1) posLabel = `${pos}${ord(pos)} to bid · right of dealer`;
  else posLabel = `${pos}${ord(pos)} to bid`;
  $('modal-position').textContent = posLabel;

  const cur = state.pendingBids[playerIdx];
  const inp = $('modal-input');
  inp.max = cards;
  inp.value = cur == null ? '' : cur;
  // Focus and select
  setTimeout(() => { inp.focus(); inp.select(); }, 50);

  // Build numeric pad 0..cards
  const pad = $('modal-pad');
  pad.innerHTML = '';
  let forbidden = -1;
  if (isLast) {
    const otherSum = state.pendingBids.reduce((a, b, i) => i === playerIdx ? a : a + (b ?? 0), 0);
    forbidden = cards - otherSum;
  }
  for (let n = 0; n <= cards; n++) {
    const btn = document.createElement('button');
    btn.textContent = n;
    btn.type = 'button';
    if (n === forbidden) btn.classList.add('disabled');
    if (cur === n) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      if (n === forbidden) return;
      state.pendingBids[playerIdx] = n;
      inp.value = n;
      saveActive();
      // Update selected highlight
      pad.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      // Auto-advance after short delay (mobile friendly)
      modalNext();
    });
    pad.appendChild(btn);
  }

  // Hint
  const hint = $('modal-hint');
  if (isLast) {
    const otherSum = state.pendingBids.reduce((a, b, i) => i === playerIdx ? a : a + (b ?? 0), 0);
    const forb = cards - otherSum;
    if (forb >= 0 && forb <= cards) {
      hint.className = 'modal-hint';
      hint.textContent = `⚠️ Dealer cannot bid ${forb} (others bid ${otherSum}, would total ${cards}).`;
    } else {
      hint.className = 'modal-hint info';
      hint.textContent = `Others bid ${otherSum} — any 0–${cards} allowed.`;
    }
  } else {
    hint.className = 'modal-hint info';
    hint.textContent = '';
  }

  $('modal-back').disabled = step === 0;
  $('modal-next').textContent = isLast ? '✓ Finish bids' : 'Next →';
}

function ord(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function modalCommitInput() {
  if (!modalCtx) return true;
  const { order, step } = modalCtx;
  const playerIdx = order[step];
  const isLast = step === order.length - 1;
  const cards = state.rounds[state.currentRound];
  const raw = $('modal-input').value.trim();
  if (raw === '') { state.pendingBids[playerIdx] = 0; }
  else {
    let v = clampInt(raw, 0, cards);
    if (isLast) {
      const otherSum = state.pendingBids.reduce((a, b, i) => i === playerIdx ? a : a + (b ?? 0), 0);
      const forb = cards - otherSum;
      if (v === forb) {
        $('modal-hint').className = 'modal-hint';
        $('modal-hint').textContent = `⚠️ Dealer can't bid ${forb}. Pick a different number.`;
        return false;
      }
    }
    state.pendingBids[playerIdx] = v;
  }
  saveActive();
  return true;
}

function modalNext() {
  if (!modalCtx) return;
  if (!modalCommitInput()) return;
  if (modalCtx.step === modalCtx.order.length - 1) {
    // Finish — go into playing phase
    closeModal();
    lockBids();
    return;
  }
  modalCtx.step += 1;
  renderModal();
}

function modalBack() {
  if (!modalCtx || modalCtx.step === 0) return;
  modalCtx.step -= 1;
  renderModal();
}

// -------- Finish / Summary --------
function finishGame() {
  stopTimer();
  const finished = { ...state, finishedAt: new Date().toISOString() };
  const list = loadHistory();
  list.unshift(finished);
  STORE.setItem(STORAGE_KEY, JSON.stringify(list));
  STORE.removeItem(ACTIVE_KEY);
  state = finished;
  viewingShared = false;
  renderSummary(finished);
  showView('summary');
}

function endGameEarly() {
  if (!confirm('End game now? Current progress will be saved as a finished game.')) return;
  finishGame();
}

function renderSummary(game) {
  const totals = game.history.length ? game.history[game.history.length - 1].totals : game.players.map(() => 0);
  const ranked = game.players.map((p, i) => ({ name: p, score: totals[i], idx: i }))
    .sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  $('winner-banner').innerHTML = `🏆 Winner: <b>${escapeHtml(winner.name)}</b> with ${winner.score} points` +
    (viewingShared ? '<div style="font-size:.85rem;margin-top:.3rem;opacity:.9">📤 Shared game (read-only)</div>' : '');

  // Share row
  $('share-row').classList.toggle('hidden', false);
  $('share-game-btn').textContent = viewingShared ? '🔗 Copy shareable link' : '🔗 Copy shareable link';
  $('import-shared-btn').classList.toggle('hidden', !viewingShared);

  if (chartInstance) chartInstance.destroy();
  const labels = ['Start', ...game.history.map((_, i) => `R${i + 1}`)];
  const colors = ['#4caf83', '#5b9dff', '#e3654d', '#d9a441', '#c084fc', '#22c1c3', '#f472b6'];
  const datasets = game.players.map((p, i) => ({
    label: p,
    data: [0, ...game.history.map(r => r.totals[i])],
    borderColor: colors[i % colors.length],
    backgroundColor: colors[i % colors.length] + '33',
    tension: 0.25, fill: false,
  }));
  chartInstance = new Chart($('score-chart'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#e8eaed' } } },
      scales: {
        x: { ticks: { color: '#8a93a0' }, grid: { color: '#2a323d' } },
        y: { ticks: { color: '#8a93a0' }, grid: { color: '#2a323d' } },
      },
    },
  });

  const stats = computeStats(game);
  const sb = $('stats-block');
  sb.innerHTML = '';
  stats.forEach(s => {
    sb.innerHTML += `<div class="stat-card"><div class="stat-label">${s.label}</div><div class="stat-value">${s.value}</div></div>`;
  });

  const ft = $('final-table');
  ft.innerHTML = `
    <thead><tr><th>Rank</th><th>Player</th><th>Score</th><th>Correct bids</th><th>Best streak</th><th>Best/Worst round</th></tr></thead>
    <tbody>
      ${ranked.map((r, i) => {
        const ph = game.history.map(h => h.bids[r.idx] === h.actuals[r.idx]);
        const correct = ph.filter(Boolean).length;
        const streakHit = longestRun(ph, true);
        const streakMiss = longestRun(ph, false);
        const best = game.history.length ? game.history.reduce((m, h) => Math.max(m, h.deltas[r.idx]), -Infinity) : 0;
        const worst = game.history.length ? game.history.reduce((m, h) => Math.min(m, h.deltas[r.idx]), Infinity) : 0;
        return `<tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(r.name)}</td>
          <td><b>${r.score}</b></td>
          <td>${correct} / ${game.history.length}</td>
          <td>✓${streakHit} / ✗${streakMiss}</td>
          <td>${best === -Infinity ? '—' : (best >= 0 ? '+' : '') + best} / ${worst === Infinity ? '—' : (worst >= 0 ? '+' : '') + worst}</td>
        </tr>`;
      }).join('')}
    </tbody>`;

  renderPositionStats(game);
  renderPlayerDetail(game);
  renderBidNumberStats(game);
  // Reset full-table toggle
  const ftw = $('full-table-wrap');
  if (ftw) ftw.classList.add('hidden');
  const ftb = $('view-fulltable-btn');
  if (ftb) ftb.textContent = '📊 Full game table';
}

function longestRun(arr, val) {
  let best = 0, cur = 0;
  for (const v of arr) { if (v === val) { cur++; if (cur > best) best = cur; } else cur = 0; }
  return best;
}

function renderFullGameTable(game) {
  const N = game.players.length;
  let header = '<tr><th class="round-cell">Round</th>';
  game.players.forEach(p => header += `<th>${escapeHtml(p)}</th>`);
  header += '</tr>';
  let html = '<thead>' + header + '</thead><tbody>';
  game.history.forEach((r, ri) => {
    const tr = SUITS.find(s => s.name === r.trump);
    const dealer = ((game.firstDealer || 0) + ri) % N;
    const bidSum = r.bids.reduce((a, b) => a + b, 0);
    const diff = bidSum - r.cards;
    const diffCls = diff > 0 ? 'over' : (diff < 0 ? 'under' : '');
    const diffStr = diff === 0 ? '=cards' : (diff > 0 ? `+${diff}` : `${diff}`);
    html += `<tr><td class="round-cell">
      <div><span class="cards-num">${r.cards}</span><span class="trump-sym ${tr.cls}">${tr.sym}</span></div>
      <small>R${ri + 1}</small>
      <span class="round-bidsum ${diffCls}">bids ${bidSum} (${diffStr})</span>
    </td>`;
    game.players.forEach((p, pi) => {
      const ok = r.bids[pi] === r.actuals[pi];
      const isDealer = pi === dealer;
      const dStr = (r.deltas[pi] >= 0 ? '+' : '') + r.deltas[pi];
      html += `<td class="${isDealer ? 'dealer-col' : ''}">
        <div class="cell-stack">
          <span class="bid-with-delta">
            <span class="bid-result ${ok ? 'bid-correct' : 'bid-miss'}">${r.bids[pi]}</span><sup class="delta-sup ${r.deltas[pi] >= 0 ? 'pos' : 'neg'}">${dStr}</sup>
          </span>
          <span class="cell-total">${r.totals[pi]}</span>
        </div>
      </td>`;
    });
    html += '</tr>';
  });
  html += '</tbody><tfoot>' + header.replace(/<th /g, '<td ').replace(/<\/th>/g, '</td>') + '</tfoot>';
  $('summary-full-table').innerHTML = html;
}

function renderPlayerDetail(game) {
  const wrap = $('player-detail-block');
  if (!game.history.length) { wrap.innerHTML = ''; return; }
  if (game._selectedPlayer == null) game._selectedPlayer = 0;
  const pi = game._selectedPlayer;
  const N = game.players.length;

  const tabs = game.players.map((p, i) =>
    `<button class="player-tab ${i === pi ? 'active' : ''}" data-pi="${i}">${escapeHtml(p)}</button>`
  ).join('');

  // Per-player aggregate
  let hits = 0, over = 0, under = 0, bestRound = -Infinity, worstRound = Infinity;
  let bestRoundIdx = 0, worstRoundIdx = 0;
  let totalBid = 0, totalGot = 0;
  const hitPattern = [];
  game.history.forEach((h, ri) => {
    const b = h.bids[pi], a = h.actuals[pi], d = h.deltas[pi];
    if (b === a) { hits++; hitPattern.push(true); }
    else { hitPattern.push(false); }
    if (b > a) over++; else if (b < a) under++;
    if (d > bestRound) { bestRound = d; bestRoundIdx = ri; }
    if (d < worstRound) { worstRound = d; worstRoundIdx = ri; }
    totalBid += b; totalGot += a;
  });
  const rounds = game.history.length;
  const totals = game.history[rounds - 1].totals;
  const finalScore = totals[pi];
  const rank = [...totals.keys()].sort((a, b) => totals[b] - totals[a]).indexOf(pi) + 1;
  const longestHit = longestRun(hitPattern, true);
  const longestMiss = longestRun(hitPattern, false);

  // Per-round mini cells
  const pills = game.history.map((h, ri) => {
    const b = h.bids[pi], a = h.actuals[pi], d = h.deltas[pi];
    const ok = b === a;
    const tr = SUITS.find(s => s.name === h.trump);
    return `<div class="player-round-pill">
      <span class="pr-trump ${tr.cls}">${tr.sym}${h.cards}</span>
      <span class="bid-result ${ok ? 'bid-correct' : 'bid-miss'}" style="width:22px;height:22px;font-size:.75rem">${b}</span>
      <span>got ${a}</span>
      <span class="pr-delta ${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '+' : ''}${d}</span>
    </div>`;
  }).join('');

  wrap.innerHTML = `
    <h3>Per-player breakdown</h3>
    <div class="player-tabs">${tabs}</div>
    <div class="player-detail-grid">
      <div class="stat-card"><div class="stat-label">Final score</div><div class="stat-value">${finalScore} (rank #${rank})</div></div>
      <div class="stat-card"><div class="stat-label">Accuracy</div><div class="stat-value">${hits}/${rounds} (${Math.round(hits/rounds*100)}%)</div></div>
      <div class="stat-card"><div class="stat-label">Over / Under / Exact</div><div class="stat-value">${over} / ${under} / ${hits}</div></div>
      <div class="stat-card"><div class="stat-label">Best / worst round</div><div class="stat-value">${bestRound >= 0 ? '+' : ''}${bestRound} (R${bestRoundIdx+1}) / ${worstRound >= 0 ? '+' : ''}${worstRound} (R${worstRoundIdx+1})</div></div>
      <div class="stat-card"><div class="stat-label">Longest streaks</div><div class="stat-value">✓${longestHit} / ✗${longestMiss}</div></div>
      <div class="stat-card"><div class="stat-label">Total bid / got</div><div class="stat-value">${totalBid} / ${totalGot}</div></div>
    </div>
    <div class="player-rounds">${pills}</div>
  `;
  wrap.querySelectorAll('.player-tab').forEach(t => t.addEventListener('click', () => {
    game._selectedPlayer = +t.dataset.pi;
    renderPlayerDetail(game);
  }));
}

function renderBidNumberStats(game) {
  const wrap = $('bid-number-stats');
  if (!game.history.length) { wrap.innerHTML = ''; return; }
  // For each bid value (0..maxCards seen), accuracy across all players/rounds
  const maxBid = Math.max(0, ...game.history.flatMap(h => h.bids));
  const counts = Array.from({ length: maxBid + 1 }, () => ({ tries: 0, hits: 0 }));
  game.history.forEach(h => {
    h.bids.forEach((b, i) => {
      counts[b].tries += 1;
      if (b === h.actuals[i]) counts[b].hits += 1;
    });
  });
  const cells = counts.map((c, b) => {
    if (!c.tries) return `<div class="bid-acc-cell" style="opacity:.4">
      <div class="bac-bid">${b}</div>
      <div class="bac-pct">—</div>
      <div class="bac-cnt">0 tries</div>
    </div>`;
    const pct = Math.round(c.hits / c.tries * 100);
    return `<div class="bid-acc-cell">
      <div class="bac-bid">${b}</div>
      <div class="bac-pct">${pct}%</div>
      <div class="bac-cnt">${c.hits}/${c.tries}</div>
      <div class="bac-bar" style="width:${pct}%"></div>
    </div>`;
  }).join('');
  const totalTries = counts.reduce((a, c) => a + c.tries, 0);
  const totalHits = counts.reduce((a, c) => a + c.hits, 0);
  const overall = totalTries ? Math.round(totalHits / totalTries * 100) : 0;
  wrap.innerHTML = `
    <h3>Bid success rate by number · overall ${overall}% (${totalHits}/${totalTries})</h3>
    <div class="bid-acc-grid">${cells}</div>
  `;
}

function renderPositionStats(game) {
  const N = game.players.length;
  // Aggregate scores by position relative to dealer for that round
  // position 0 = dealer, 1 = left of dealer (first bidder), ..., N-1 = right of dealer (bids before dealer)
  const posStats = Array.from({ length: N }, () => ({ delta: 0, correct: 0, total: 0 }));
  game.history.forEach((h, ri) => {
    const dealer = (game.firstDealer + ri) % N;
    for (let pi = 0; pi < N; pi++) {
      const pos = (pi - dealer + N) % N;
      posStats[pos].delta += h.deltas[pi];
      posStats[pos].total += 1;
      if (h.bids[pi] === h.actuals[pi]) posStats[pos].correct += 1;
    }
  });

  const labels = posStats.map((_, p) => {
    if (p === 0) return 'Dealer';
    if (p === 1) return 'Left of dealer (first bid)';
    if (p === N - 1) return 'Right of dealer (bids before dealer)';
    return `${p}${ord(p)} to bid`;
  });

  // Rank by avg points per round
  const ranked = posStats.map((s, p) => ({
    p,
    label: labels[p],
    avg: s.total ? s.delta / s.total : 0,
    acc: s.total ? s.correct / s.total : 0,
    total: s.delta,
    rounds: s.total,
  })).sort((a, b) => b.avg - a.avg);

  const wrap = $('position-stats');
  wrap.innerHTML = `<h3>Position vs dealer · easiest → hardest (avg points/round)</h3>
    <div class="position-list">
      ${ranked.map((r, i) => `<div class="position-row">
        <span class="pos-label">#${i + 1} ${escapeHtml(r.label)}</span>
        <span>avg ${(r.avg >= 0 ? '+' : '') + r.avg.toFixed(1)} pts</span>
        <span>${Math.round(r.acc * 100)}% hit</span>
        <span class="pos-value">${(r.total >= 0 ? '+' : '') + r.total}</span>
      </div>`).join('')}
    </div>`;
}

function computeStats(game) {
  const stats = [];
  const rounds = game.history.length;
  if (!rounds) return [{ label: 'Rounds played', value: 0 }];
  const N = game.players.length;

  // Most accurate
  const accuracy = game.players.map((p, i) => ({
    name: p, correct: game.history.filter(h => h.bids[i] === h.actuals[i]).length,
  }));
  accuracy.sort((a, b) => b.correct - a.correct);
  stats.push({ label: 'Most accurate', value: `${accuracy[0].name} (${accuracy[0].correct}/${rounds})` });

  // Best streak (win)
  let bestStreak = { name: '—', n: 0 };
  for (let pi = 0; pi < N; pi++) {
    const arr = game.history.map(h => h.bids[pi] === h.actuals[pi]);
    const run = longestRun(arr, true);
    if (run > bestStreak.n) bestStreak = { name: game.players[pi], n: run };
  }
  stats.push({ label: 'Best hit streak', value: `${bestStreak.name} ×${bestStreak.n}` });

  // Worst streak (miss)
  let worstStreak = { name: '—', n: 0 };
  for (let pi = 0; pi < N; pi++) {
    const arr = game.history.map(h => h.bids[pi] === h.actuals[pi]);
    const run = longestRun(arr, false);
    if (run > worstStreak.n) worstStreak = { name: game.players[pi], n: run };
  }
  stats.push({ label: 'Worst miss streak', value: `${worstStreak.name} ×${worstStreak.n}` });

  // Biggest / worst round
  let bigDelta = { name: '—', delta: -Infinity, round: 0 };
  game.history.forEach((h, ri) => h.deltas.forEach((d, pi) => {
    if (d > bigDelta.delta) bigDelta = { name: game.players[pi], delta: d, round: ri + 1 };
  }));
  stats.push({ label: 'Biggest round', value: `${bigDelta.name} +${bigDelta.delta} (R${bigDelta.round})` });

  let worstDelta = { name: '—', delta: Infinity, round: 0 };
  game.history.forEach((h, ri) => h.deltas.forEach((d, pi) => {
    if (d < worstDelta.delta) worstDelta = { name: game.players[pi], delta: d, round: ri + 1 };
  }));
  stats.push({ label: 'Worst round', value: `${worstDelta.name} ${worstDelta.delta} (R${worstDelta.round})` });

  // Net over/under bid
  const totalBids = game.history.reduce((a, h) => a + h.bids.reduce((x, y) => x + y, 0), 0);
  const totalCards = game.history.reduce((a, h) => a + h.cards, 0);
  stats.push({ label: 'Net over/under-bid', value: `${(totalBids - totalCards >= 0 ? '+' : '')}${(totalBids - totalCards)} tricks` });

  // Lead changes
  let leadChanges = 0, lastLead = -1;
  game.history.forEach(h => {
    let leader = 0;
    h.totals.forEach((t, i) => { if (t > h.totals[leader]) leader = i; });
    if (lastLead !== -1 && leader !== lastLead) leadChanges++;
    lastLead = leader;
  });
  stats.push({ label: 'Lead changes', value: leadChanges });

  // Time stats
  const durations = (game.roundDurations || []).filter(d => d > 0);
  if (durations.length) {
    const totalMs = durations.reduce((a, b) => a + b, 0);
    const avgMs = totalMs / durations.length;
    const maxMs = Math.max(...durations);
    const minMs = Math.min(...durations);
    stats.push({ label: 'Total time', value: formatDuration(totalMs) });
    stats.push({ label: 'Avg / round', value: formatDuration(avgMs) });
    stats.push({ label: 'Fastest / slowest', value: `${formatDuration(minMs)} / ${formatDuration(maxMs)}` });
  }

  // Over-bid vs under-bid behaviour per player
  const overUnder = game.players.map((p, i) => {
    let over = 0, under = 0, exact = 0;
    game.history.forEach(h => {
      if (h.bids[i] > h.actuals[i]) over++;
      else if (h.bids[i] < h.actuals[i]) under++;
      else exact++;
    });
    return { name: p, over, under, exact, total: game.history.length };
  });
  const mostOver = [...overUnder].sort((a, b) => b.over - a.over)[0];
  const mostUnder = [...overUnder].sort((a, b) => b.under - a.under)[0];
  if (mostOver.over > 0) stats.push({ label: 'Most over-bids', value: `${mostOver.name} (${mostOver.over}/${rounds})` });
  if (mostUnder.under > 0) stats.push({ label: 'Most under-bids', value: `${mostUnder.name} (${mostUnder.under}/${rounds})` });

  stats.push({ label: 'Rounds played', value: rounds });
  return stats;
}

// -------- Share --------
async function copyShareLink() {
  const url = buildShareUrl();
  if (!url) return;
  await writeClip(url, '✓ Link copied!');
}

async function copyShortShareLink() {
  const url = buildShareUrl();
  if (!url) return;
  const status = $('share-status');
  if (status) status.textContent = 'Shortening…';
  try {
    const short = await shortenUrl(url);
    await writeClip(short, '✓ Short link copied: ' + short);
  } catch (e) {
    if (status) status.textContent = '⚠️ Shortener failed, copied full link';
    await writeClip(url, '');
  }
}

async function shortenUrl(longUrl) {
  // Try is.gd first (CORS-friendly, no key)
  try {
    const r = await fetch('https://is.gd/create.php?format=simple&url=' + encodeURIComponent(longUrl));
    if (r.ok) {
      const t = (await r.text()).trim();
      if (/^https?:\/\//i.test(t)) return t;
    }
  } catch {}
  // Fallback: TinyURL
  try {
    const r = await fetch('https://tinyurl.com/api-create.php?url=' + encodeURIComponent(longUrl));
    if (r.ok) {
      const t = (await r.text()).trim();
      if (/^https?:\/\//i.test(t)) return t;
    }
  } catch {}
  throw new Error('no shortener available');
}

async function writeClip(text, successMsg) {
  const status = $('share-status');
  try {
    await navigator.clipboard.writeText(text);
    if (status) { status.textContent = successMsg || ''; setTimeout(() => { status.textContent = ''; }, 4000); }
    else if (successMsg) alert(successMsg);
  } catch {
    prompt('Copy this link:', text);
  }
}

function buildShareUrl() {
  if (!state) return null;
  const slim = {
    v: 1,
    p: state.players,
    s: state.startCards,
    d: state.direction,
    fd: state.firstDealer,
    h: state.history.map(h => ({ c: h.cards, b: h.bids, a: h.actuals, dur: h.durationMs || 0 })),
    sa: state.startedAt,
    fa: state.finishedAt,
  };
  const json = JSON.stringify(slim);
  const b64 = btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#g=${b64}`;
}

function importSharedGame() {
  if (!state || !viewingShared) return;
  const list = loadHistory();
  const fingerprint = (state.startedAt || '') + '|' + (state.players || []).join(',');
  if (list.some(g => ((g.startedAt || '') + '|' + (g.players || []).join(',')) === fingerprint)) {
    if (!confirm('Looks like you already have this game in history. Import again anyway?')) return;
  }
  const imported = {
    ...state,
    finishedAt: state.finishedAt || new Date().toISOString(),
    imported: true,
  };
  list.unshift(imported);
  STORE.setItem(STORAGE_KEY, JSON.stringify(list));
  const s = $('share-status');
  s.textContent = '✓ Imported to history';
  setTimeout(() => { s.textContent = ''; }, 3000);
}

function loadSharedFromHash() {
  const m = location.hash.match(/g=([A-Za-z0-9_\-]+)/);
  if (!m) return false;
  try {
    let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const json = decodeURIComponent(escape(atob(b64)));
    const slim = JSON.parse(json);
    if (!slim || !slim.p || !slim.h) return false;
    const N = slim.p.length;
    // Reconstruct full game
    const history = [];
    const totals = slim.p.map(() => 0);
    slim.h.forEach((h, ri) => {
      const cards = h.c;
      const trump = SUITS[ri % SUITS.length];
      const deltas = h.b.map((b, i) => scoreFor(b, h.a[i]));
      for (let i = 0; i < N; i++) totals[i] += deltas[i];
      history.push({
        cards, trump: trump.name, trumpSym: trump.sym,
        bids: h.b, actuals: h.a, deltas, totals: [...totals], durationMs: h.dur || 0,
      });
    });
    state = {
      players: slim.p,
      startCards: slim.s,
      direction: slim.d,
      firstDealer: slim.fd,
      history,
      currentRound: history.length,
      rounds: buildRoundsList(slim.s, slim.d),
      startedAt: slim.sa,
      finishedAt: slim.fa,
      roundDurations: history.map(h => h.durationMs || 0),
    };
    viewingShared = true;
    renderSummary(state);
    showView('summary');
    return true;
  } catch (e) {
    console.warn('Bad share hash', e);
    return false;
  }
}

// -------- History --------
function loadHistory() {
  try { return JSON.parse(STORE.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function renderHistory() {
  const list = $('history-list');
  const games = loadHistory();
  if (!games.length) { list.innerHTML = '<p style="color:var(--muted)">No games saved yet.</p>'; return; }
  list.innerHTML = '';
  games.forEach((g, idx) => {
    const totals = g.history.length ? g.history[g.history.length - 1].totals : g.players.map(() => 0);
    const ranked = g.players.map((p, i) => ({ name: p, score: totals[i] })).sort((a, b) => b.score - a.score);
    const card = document.createElement('div');
    card.className = 'history-card';
    const durations = (g.roundDurations || []).filter(d => d > 0);
    const totalMs = durations.reduce((a, b) => a + b, 0);
    card.innerHTML = `
      <div>
        <h4>${escapeHtml(ranked[0].name)} won (${ranked[0].score})</h4>
        <div class="history-meta">
          ${new Date(g.startedAt).toLocaleString()} ·
          ${g.players.length} players · ${g.history.length} rounds
          ${totalMs ? ' · ' + formatDuration(totalMs) : ''}
        </div>
      </div>
      <button class="secondary" data-view="${idx}">View</button>
    `;
    list.appendChild(card);
  });
  list.querySelectorAll('button[data-view]').forEach(b => b.addEventListener('click', () => {
    const idx = +b.dataset.view;
    state = games[idx];
    if (state.firstDealer == null) state.firstDealer = 0;
    if (!state.roundDurations) state.roundDurations = [];
    viewingShared = false;
    renderSummary(state);
    showView('summary');
  }));
}

// -------- Utility --------
function saveActive() { STORE.setItem(ACTIVE_KEY, JSON.stringify(state)); }
function clampInt(v, min, max) { let n = parseInt(v, 10); if (isNaN(n)) n = min; return Math.max(min, Math.min(max, n)); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

function showView(name) {
  ['setup', 'game', 'summary', 'history'].forEach(v => $('view-' + v).classList.toggle('hidden', v !== name));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (name === 'history') $('nav-history').classList.add('active');
  else if (name === 'setup') $('nav-new').classList.add('active');
  if (name !== 'game') stopTimer();
}

// -------- Init --------
function init() {
  $('setup-players').addEventListener('input', renderPlayerNames);
  $('setup-start').addEventListener('input', () => { $('setup-start').dataset.userSet = '1'; });
  renderPlayerNames();
  $('start-game').addEventListener('click', startGame);
  $('lock-bids').addEventListener('click', lockBids);
  $('commit-round').addEventListener('click', commitRound);
  $('undo-round').addEventListener('click', undoLastRound);
  $('end-game-btn').addEventListener('click', endGameEarly);
  $('quick-entry-btn').addEventListener('click', openQuickEntry);
  $('modal-close').addEventListener('click', closeModal);
  $('modal-next').addEventListener('click', modalNext);
  $('modal-back').addEventListener('click', modalBack);
  $('modal-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); modalNext(); }
  });
  $('share-game-btn').addEventListener('click', copyShareLink);
  $('share-short-btn').addEventListener('click', copyShortShareLink);
  $('share-mid-btn').addEventListener('click', copyShareLink);
  $('share-mid-short-btn').addEventListener('click', copyShortShareLink);
  $('import-shared-btn').addEventListener('click', importSharedGame);

  $('play-again').addEventListener('click', () => {
    state = null; STORE.removeItem(ACTIVE_KEY); viewingShared = false;
    history.replaceState(null, '', location.pathname);
    showView('setup');
  });
  $('view-history-btn').addEventListener('click', () => { renderHistory(); showView('history'); });
  $('view-fulltable-btn').addEventListener('click', () => {
    const wrap = $('full-table-wrap');
    const hidden = wrap.classList.contains('hidden');
    if (hidden) {
      renderFullGameTable(state);
      wrap.classList.remove('hidden');
      $('view-fulltable-btn').textContent = '📊 Hide full table';
      wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      wrap.classList.add('hidden');
      $('view-fulltable-btn').textContent = '📊 Full game table';
    }
  });
  $('nav-new').addEventListener('click', () => {
    if (state && state.history && state.currentRound < state.rounds.length && !viewingShared) {
      if (!confirm('Abandon current game?')) return;
      STORE.removeItem(ACTIVE_KEY);
      state = null;
    }
    history.replaceState(null, '', location.pathname);
    viewingShared = false;
    showView('setup');
  });
  $('nav-history').addEventListener('click', () => { renderHistory(); showView('history'); });
  $('clear-history').addEventListener('click', () => {
    if (confirm('Clear all saved games?')) { STORE.removeItem(STORAGE_KEY); renderHistory(); }
  });

  // Shared game via URL hash takes priority
  if (loadSharedFromHash()) return;

  const active = STORE.getItem(ACTIVE_KEY);
  if (active) {
    try {
      state = JSON.parse(active);
      if (state && state.currentRound < state.rounds.length) {
        if (!state.roundDurations) state.roundDurations = [];
        if (!state.roundStartedAt) state.roundStartedAt = Date.now();
        // Normalize legacy 0-defaults so inputs render empty
        if (Array.isArray(state.pendingBids) && state.phase === 'bidding') {
          state.pendingBids = state.pendingBids.map(b => b === 0 ? null : b);
        }
        if (Array.isArray(state.pendingActuals) && state.phase === 'playing') {
          state.pendingActuals = state.pendingActuals.map(a => a === 0 ? null : a);
        }
        showView('game');
        renderGame();
        return;
      }
    } catch {}
  }
  showView('setup');
}

document.addEventListener('DOMContentLoaded', init);
