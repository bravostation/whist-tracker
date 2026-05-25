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
const KNOWN_PLAYERS_KEY = 'whist_known_players_v1';
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
  // Preserve any names the user already typed when resizing
  const existing = [];
  wrap.querySelectorAll('input').forEach(inp => existing.push((inp.value || '').trim()));
  wrap.innerHTML = '';
  const kp = loadKnownPlayers();
  const lastRoster = (kp.rosters || []).find(r => r.players.length === n);
  for (let i = 0; i < n; i++) {
    const lbl = document.createElement('label');
    let preset = existing[i];
    if (!preset || /^Player \d+$/.test(preset)) {
      preset = (lastRoster && lastRoster.players[i]) || `Player ${i + 1}`;
    }
    lbl.innerHTML = `Seat ${i + 1} <input type="text" data-player="${i}" value="${escapeHtml(preset)}" />`;
    wrap.appendChild(lbl);
    const inp = lbl.querySelector('input');
    inp.addEventListener('focus', () => { try { inp.select(); } catch {} });
    inp.addEventListener('input', renderStarterButtons);
  }
  const maxC = maxCardsFor(n);
  const startInp = $('setup-start');
  startInp.max = maxC;
  if (!startInp.dataset.userSet || parseInt(startInp.value, 10) > maxC) startInp.value = maxC;
  $('setup-max-note').textContent = `Max for ${n} players: ${maxC}`;
  if (setupSelectedStarter !== 'random' && setupSelectedStarter >= n) setupSelectedStarter = 'random';
  renderStarterButtons();
  renderAutofillChips();
}

// -------- Known players autofill --------
function loadKnownPlayers() {
  try { return JSON.parse(STORE.getItem(KNOWN_PLAYERS_KEY) || '{"rosters":[],"names":{}}'); }
  catch { return { rosters: [], names: {} }; }
}

function rememberRoster(players) {
  const kp = loadKnownPlayers();
  const now = Date.now();
  const sig = players.join('|');
  kp.rosters = (kp.rosters || []).filter(r => r.players.join('|') !== sig);
  kp.rosters.unshift({ players: [...players], lastUsed: now });
  kp.rosters = kp.rosters.slice(0, 12);
  kp.names = kp.names || {};
  for (const n of players) {
    if (!n) continue;
    const e = kp.names[n] || { count: 0, lastUsed: 0 };
    e.count += 1;
    e.lastUsed = now;
    kp.names[n] = e;
  }
  try { STORE.setItem(KNOWN_PLAYERS_KEY, JSON.stringify(kp)); } catch {}
}

function renderAutofillChips() {
  const wrap = $('autofill-chips');
  if (!wrap) return;
  const kp = loadKnownPlayers();
  const N = parseInt($('setup-players').value, 10) || 4;
  const rosters = (kp.rosters || []).filter(r => r.players.length === N).slice(0, 3);
  const recentNames = Object.entries(kp.names || {})
    .sort((a, b) => (b[1].lastUsed || 0) - (a[1].lastUsed || 0))
    .slice(0, 14)
    .map(([name]) => name);

  if (!rosters.length && !recentNames.length) { wrap.innerHTML = ''; return; }

  let html = '';
  if (rosters.length) {
    html += '<div class="autofill-hint">Recent rosters:</div>';
    rosters.forEach((r, i) => {
      html += `<button type="button" class="autofill-roster" data-roster="${i}">${i === 0 ? '⭐ ' : ''}${r.players.map(escapeHtml).join(' · ')}</button>`;
    });
  }
  if (recentNames.length) {
    html += '<div class="autofill-hint">Tap a name to fill the next seat:</div><div class="autofill-row">' +
      recentNames.map(n => `<button type="button" class="autofill-chip" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join('') + '</div>';
  }
  wrap.innerHTML = html;

  wrap.querySelectorAll('.autofill-roster').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = rosters[+btn.dataset.roster];
      if (!r) return;
      document.querySelectorAll('#setup-names input').forEach((inp, i) => {
        inp.value = r.players[i] || `Player ${i + 1}`;
      });
      renderStarterButtons();
    });
  });
  wrap.querySelectorAll('.autofill-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.name;
      const inputs = document.querySelectorAll('#setup-names input');
      let target = null;
      for (const inp of inputs) {
        const v = (inp.value || '').trim();
        if (!v || /^Player \d+$/.test(v)) { target = inp; break; }
      }
      if (!target) target = inputs[inputs.length - 1];
      if (target) {
        target.value = name;
        renderStarterButtons();
      }
    });
  });
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
  rememberRoster(players);
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
    const durStr = r.durationMs ? `<span class="round-time" title="Time bids→scored">⏱${formatDuration(r.durationMs)}</span>` : '';
    html += `<tr><td class="round-cell">
      <div><span class="cards-num">${r.cards}</span><span class="trump-sym ${rTrump.cls}">${rTrump.sym}</span></div>
      <small>R${ri + 1}</small>
      <span class="round-bidsum ${diffCls}">bids ${bidSum} (${diffStr})</span>
      ${durStr}
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
  // Update quick-entry button labels per phase
  const qLabel = state.phase === 'bidding' ? '⚡ Quick bid' : '⚡ Quick score';
  document.querySelectorAll('.quick-entry-btn').forEach(b => b.textContent = qLabel);
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
  // Close any open quick-entry modal so its cached order/step can't desync
  if (modalCtx) { $('modal-backdrop').classList.add('hidden'); modalCtx = null; }
  if (state.phase === 'playing') {
    state.phase = 'bidding';
    // Clear actuals so re-entering bids doesn't carry stale trick counts forward
    state.pendingActuals = state.players.map(() => null);
    saveActive();
    renderGame();
    return;
  }
  if (state.history.length === 0) return;
  if (!confirm('Undo last completed round?')) return;
  const last = state.history.pop();
  state.roundDurations.pop();
  state.currentRound -= 1;
  // Restore the bids exactly as they were (indexed by seat — dealer order is
  // re-derived from currentRound so seat indices stay aligned).
  state.pendingBids = [...last.bids];
  // Always reset actuals on undo — the previous actuals belonged to a now-popped
  // round; keeping them caused a stale dealer/order pre-fill on re-entry.
  state.pendingActuals = state.players.map(() => null);
  state.phase = 'bidding';
  state.roundStartedAt = Date.now();
  saveActive();
  renderGame();
}

// -------- Quick entry modal --------
let modalCtx = null;

function openQuickEntry() {
  // Order for bidding: left-of-dealer first, dealer last.
  // Order for scoring: same order works fine (any consistent rotation).
  const order = bidOrderForRound(state.currentRound);
  modalCtx = { order, step: 0, phase: state.phase };
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
  const { order, step, phase } = modalCtx;
  const isBid = phase === 'bidding';
  const cards = state.rounds[state.currentRound];
  const dealerIdx = dealerForRound(state.currentRound);
  const N = state.players.length;
  const playerIdx = order[step];
  const isLast = step === order.length - 1;
  const labelWord = isBid ? 'bid' : 'tricks won';
  const labelWordCap = isBid ? 'Bid' : 'Score';

  $('modal-title').textContent = `Round ${state.currentRound + 1} ${isBid ? 'bids' : 'scoring'} · ${cards} cards · ${trumpFor(state.currentRound).sym} trump`;
  $('modal-sub').textContent = `${labelWordCap} ${step + 1} of ${order.length}`;
  $('modal-player').textContent = state.players[playerIdx];
  const pos = positionRelativeToDealer(playerIdx, dealerIdx, N);
  let posLabel;
  if (pos === 0) posLabel = isBid ? 'DEALER (bids last)' : 'DEALER';
  else if (pos === 1) posLabel = '1st · left of dealer';
  else if (pos === N - 1) posLabel = `${pos}${ord(pos)} · right of dealer`;
  else posLabel = `${pos}${ord(pos)}`;
  $('modal-position').textContent = posLabel;

  const pending = isBid ? state.pendingBids : state.pendingActuals;
  const cur = pending[playerIdx];
  const inp = $('modal-input');
  inp.max = cards;
  inp.placeholder = '0';
  inp.value = cur == null ? '' : cur;
  setTimeout(() => { inp.focus(); selectAllValue(inp); }, 50);

  // Numeric pad
  const pad = $('modal-pad');
  pad.innerHTML = '';

  // Computed forbidden / hint values
  let forbidden = -1;
  let remaining = null;
  if (isBid && isLast) {
    const otherSum = state.pendingBids.reduce((a, b, i) => i === playerIdx ? a : a + (b ?? 0), 0);
    forbidden = cards - otherSum;
  }
  if (!isBid) {
    const otherSum = state.pendingActuals.reduce((a, b, i) => i === playerIdx ? a : a + (b ?? 0), 0);
    remaining = cards - otherSum;
  }

  for (let n = 0; n <= cards; n++) {
    const btn = document.createElement('button');
    btn.textContent = n;
    btn.type = 'button';
    if (isBid && n === forbidden) btn.classList.add('disabled');
    // For scoring last player, hint the only valid number but don't disable others (user can override)
    if (!isBid && isLast && n === remaining) btn.classList.add('selected');
    if (cur === n) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      if (isBid && n === forbidden) return;
      pending[playerIdx] = n;
      inp.value = n;
      saveActive();
      pad.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      modalNext();
    });
    pad.appendChild(btn);
  }

  // Hint
  const hint = $('modal-hint');
  if (isBid && isLast) {
    const otherSum = state.pendingBids.reduce((a, b, i) => i === playerIdx ? a : a + (b ?? 0), 0);
    const forb = cards - otherSum;
    if (forb >= 0 && forb <= cards) {
      hint.className = 'modal-hint';
      hint.textContent = `⚠️ Dealer cannot bid ${forb} (others bid ${otherSum}, would total ${cards}).`;
    } else {
      hint.className = 'modal-hint info';
      hint.textContent = `Others bid ${otherSum} — any 0–${cards} allowed.`;
    }
  } else if (!isBid) {
    const otherSum = state.pendingActuals.reduce((a, b, i) => i === playerIdx ? a : a + (b ?? 0), 0);
    const rem = cards - otherSum;
    const bidVal = state.pendingBids[playerIdx];
    hint.className = 'modal-hint info';
    let parts = [`Bid was ${bidVal}.`];
    if (isLast) parts.push(`Auto-fills to ${Math.max(0, rem)} to total ${cards}.`);
    else parts.push(`Tricks remaining: ${rem}.`);
    hint.textContent = parts.join(' ');
  } else {
    hint.className = 'modal-hint info';
    hint.textContent = '';
  }

  $('modal-back').disabled = step === 0;
  $('modal-next').textContent = isLast ? (isBid ? '✓ Finish bids' : '✓ Score round') : 'Next →';
}

function ord(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function modalCommitInput() {
  if (!modalCtx) return true;
  const { order, step, phase } = modalCtx;
  const isBid = phase === 'bidding';
  const playerIdx = order[step];
  const isLast = step === order.length - 1;
  const cards = state.rounds[state.currentRound];
  const pending = isBid ? state.pendingBids : state.pendingActuals;
  const raw = $('modal-input').value.trim();
  if (raw === '') {
    // For scoring last player, auto-fill remaining
    if (!isBid && isLast) {
      const otherSum = state.pendingActuals.reduce((a, b, i) => i === playerIdx ? a : a + (b ?? 0), 0);
      pending[playerIdx] = Math.max(0, Math.min(cards, cards - otherSum));
    } else {
      pending[playerIdx] = 0;
    }
  } else {
    let v = clampInt(raw, 0, cards);
    if (isBid && isLast) {
      const otherSum = state.pendingBids.reduce((a, b, i) => i === playerIdx ? a : a + (b ?? 0), 0);
      const forb = cards - otherSum;
      if (v === forb) {
        $('modal-hint').className = 'modal-hint';
        $('modal-hint').textContent = `⚠️ Dealer can't bid ${forb}. Pick a different number.`;
        return false;
      }
    }
    pending[playerIdx] = v;
  }
  saveActive();
  return true;
}

function modalNext() {
  if (!modalCtx) return;
  if (!modalCommitInput()) return;
  if (modalCtx.step === modalCtx.order.length - 1) {
    const wasBid = modalCtx.phase === 'bidding';
    closeModal();
    if (wasBid) lockBids();
    else commitRound();
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
  try { rememberRoster(finished.players); } catch {}
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
    const tr = SUITS.find(s => s.name === r.trump)
      || SUITS.find(s => s.sym === r.trumpSym)
      || SUITS.find(s => s.sym === r.trump)
      || { sym: r.trumpSym || r.trump || '?', cls: 'suit-nt', name: r.trump || '?' };
    const dealer = ((game.firstDealer || 0) + ri) % N;
    const bidSum = r.bids.reduce((a, b) => a + b, 0);
    const diff = bidSum - r.cards;
    const diffCls = diff > 0 ? 'over' : (diff < 0 ? 'under' : '');
    const diffStr = diff === 0 ? '=cards' : (diff > 0 ? `+${diff}` : `${diff}`);
    const durStr = r.durationMs ? `<span class="round-time" title="Time bids→scored">⏱${formatDuration(r.durationMs)}</span>` : '';
    html += `<tr><td class="round-cell">
      <div><span class="cards-num">${r.cards}</span><span class="trump-sym ${tr.cls}">${tr.sym}</span></div>
      <small>R${ri + 1}</small>
      <span class="round-bidsum ${diffCls}">bids ${bidSum} (${diffStr})</span>
      ${durStr}
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

  const adv = computePlayerAdvanced(game, pi);
  const tips = generatePlayerTips(game, pi, adv);

  // Per-player aggregate (existing summary)
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
    const tr = SUITS.find(s => s.name === h.trump)
      || SUITS.find(s => s.sym === h.trumpSym)
      || { sym: h.trumpSym || '?', cls: 'suit-nt' };
    return `<div class="player-round-pill">
      <span class="pr-trump ${tr.cls}">${tr.sym}${h.cards}</span>
      <span class="bid-result ${ok ? 'bid-correct' : 'bid-miss'}" style="width:22px;height:22px;font-size:.75rem">${b}</span>
      <span>got ${a}</span>
      <span class="pr-delta ${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '+' : ''}${d}</span>
    </div>`;
  }).join('');

  // Advanced stat cards
  const trumpRows = adv.byTrump.length ? adv.byTrump.map(t => {
    const cls = (SUITS.find(s => s.name === t.name) || {}).cls || 'suit-nt';
    const sym = (SUITS.find(s => s.name === t.name) || {}).sym || t.name;
    return `<span class="mini-tag"><b class="${cls}">${sym}</b> ${t.hits}/${t.tries} · ${(t.avg>=0?'+':'')}${t.avg.toFixed(1)}</span>`;
  }).join(' ') : '—';
  const handSizeRows = adv.byHandSize.map(h =>
    `<span class="mini-tag">${h.label}: ${h.hits}/${h.tries} (${h.pct}%)</span>`
  ).join(' ');
  const halfDelta = adv.secondHalfPts - adv.firstHalfPts;
  const arc = halfDelta > 2 ? `📈 strong finisher (+${halfDelta})` : (halfDelta < -2 ? `📉 cold finish (${halfDelta})` : '↔️ steady');

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
      <div class="stat-card"><div class="stat-label">Avg pts / round</div><div class="stat-value">${adv.avgPts >= 0 ? '+' : ''}${adv.avgPts.toFixed(2)}</div></div>
      <div class="stat-card"><div class="stat-label">Consistency (σ)</div><div class="stat-value">±${adv.stdDev.toFixed(2)}</div></div>
      <div class="stat-card"><div class="stat-label">Bid skew vs fair share</div><div class="stat-value">${adv.bidSkew >= 0 ? '+' : ''}${adv.bidSkew.toFixed(2)}/rd</div></div>
      <div class="stat-card"><div class="stat-label">Nil bids (0)</div><div class="stat-value">${adv.nil.tries ? `${adv.nil.hits}/${adv.nil.tries} (${Math.round(adv.nil.hits/adv.nil.tries*100)}%)` : '—'}</div></div>
      <div class="stat-card"><div class="stat-label">Big-hand accuracy</div><div class="stat-value">${adv.bigHand.tries ? `${adv.bigHand.hits}/${adv.bigHand.tries} (${Math.round(adv.bigHand.hits/adv.bigHand.tries*100)}%)` : '—'}</div></div>
      <div class="stat-card"><div class="stat-label">Dealer-seat record</div><div class="stat-value">${adv.dealer.tries ? `${adv.dealer.hits}/${adv.dealer.tries} (${Math.round(adv.dealer.hits/adv.dealer.tries*100)}%)` : '—'}</div></div>
      <div class="stat-card"><div class="stat-label">Lead held</div><div class="stat-value">${adv.leadRounds}/${rounds} rounds</div></div>
      <div class="stat-card"><div class="stat-label">Pts from leader</div><div class="stat-value">${adv.gapToLeader === 0 ? 'Leading 👑' : `−${adv.gapToLeader}`}</div></div>
      <div class="stat-card"><div class="stat-label">Game arc</div><div class="stat-value">${arc}</div></div>
      <div class="stat-card wide"><div class="stat-label">By trump</div><div class="stat-value">${trumpRows}</div></div>
      <div class="stat-card wide"><div class="stat-label">By hand size</div><div class="stat-value">${handSizeRows || '—'}</div></div>
    </div>
    ${tips.length ? `<div class="player-tips">
      <h4>💡 Tips for ${escapeHtml(game.players[pi])}</h4>
      <ul>${tips.map(t => `<li>${t}</li>`).join('')}</ul>
    </div>` : ''}
    <div class="player-rounds">${pills}</div>
  `;
  wrap.querySelectorAll('.player-tab').forEach(t => t.addEventListener('click', () => {
    game._selectedPlayer = +t.dataset.pi;
    renderPlayerDetail(game);
  }));
}

function computePlayerAdvanced(game, pi) {
  const N = game.players.length;
  const rounds = game.history.length;
  const deltas = game.history.map(h => h.deltas[pi]);
  const bids = game.history.map(h => h.bids[pi]);
  const actuals = game.history.map(h => h.actuals[pi]);
  const totalPts = deltas.reduce((a, b) => a + b, 0);
  const avgPts = rounds ? totalPts / rounds : 0;
  const variance = rounds ? deltas.reduce((a, d) => a + (d - avgPts) ** 2, 0) / rounds : 0;
  const stdDev = Math.sqrt(variance);
  // Bid skew vs fair share (cards/N)
  const skewSum = game.history.reduce((acc, h) => acc + (h.bids[pi] - h.cards / N), 0);
  const bidSkew = rounds ? skewSum / rounds : 0;
  // Nil
  const nil = { tries: 0, hits: 0 };
  bids.forEach((b, i) => { if (b === 0) { nil.tries++; if (actuals[i] === 0) nil.hits++; } });
  // Big hand accuracy (cards >= max/2)
  const maxCards = Math.max(...game.history.map(h => h.cards));
  const bigHand = { tries: 0, hits: 0 };
  game.history.forEach((h, ri) => { if (h.cards >= Math.ceil(maxCards / 2)) { bigHand.tries++; if (h.bids[pi] === h.actuals[pi]) bigHand.hits++; } });
  // Dealer-seat record
  const dealer = { tries: 0, hits: 0 };
  game.history.forEach((h, ri) => {
    const d = ((game.firstDealer || 0) + ri) % N;
    if (d === pi) { dealer.tries++; if (h.bids[pi] === h.actuals[pi]) dealer.hits++; }
  });
  // Lead-held rounds
  let leadRounds = 0;
  game.history.forEach(h => {
    const max = Math.max(...h.totals);
    if (h.totals[pi] === max) leadRounds++;
  });
  // Gap to leader at end
  const finalTotals = game.history[rounds - 1].totals;
  const leaderPts = Math.max(...finalTotals);
  const gapToLeader = leaderPts - finalTotals[pi];
  // First/second half points
  const half = Math.floor(rounds / 2);
  const firstHalfPts = deltas.slice(0, half).reduce((a, b) => a + b, 0);
  const secondHalfPts = deltas.slice(half).reduce((a, b) => a + b, 0);
  // By trump
  const trumpBuckets = {};
  game.history.forEach((h, ri) => {
    const key = h.trump || h.trumpSym || '?';
    if (!trumpBuckets[key]) trumpBuckets[key] = { name: key, tries: 0, hits: 0, pts: 0 };
    trumpBuckets[key].tries++;
    trumpBuckets[key].pts += h.deltas[pi];
    if (h.bids[pi] === h.actuals[pi]) trumpBuckets[key].hits++;
  });
  const byTrump = Object.values(trumpBuckets).map(t => ({ ...t, avg: t.pts / t.tries }))
    .sort((a, b) => b.avg - a.avg);
  // By hand size buckets: small (<=maxCards/3), mid, big (>=2*maxCards/3)
  const small = { label: `≤${Math.ceil(maxCards/3)}c`, tries: 0, hits: 0 };
  const mid = { label: 'mid', tries: 0, hits: 0 };
  const big = { label: `≥${Math.ceil(2*maxCards/3)}c`, tries: 0, hits: 0 };
  game.history.forEach(h => {
    let b;
    if (h.cards <= Math.ceil(maxCards / 3)) b = small;
    else if (h.cards >= Math.ceil(2 * maxCards / 3)) b = big;
    else b = mid;
    b.tries++;
    if (h.bids[pi] === h.actuals[pi]) b.hits++;
  });
  const byHandSize = [small, mid, big].filter(b => b.tries > 0).map(b => ({ ...b, pct: Math.round(b.hits / b.tries * 100) }));
  return { totalPts, avgPts, stdDev, bidSkew, nil, bigHand, dealer, leadRounds, gapToLeader, firstHalfPts, secondHalfPts, byTrump, byHandSize, maxCards };
}

function generatePlayerTips(game, pi, adv) {
  const tips = [];
  const rounds = game.history.length;
  const N = game.players.length;
  const name = game.players[pi];
  let over = 0, under = 0, hits = 0;
  game.history.forEach(h => {
    const b = h.bids[pi], a = h.actuals[pi];
    if (b > a) over++; else if (b < a) under++; else hits++;
  });
  const accuracy = hits / rounds;

  if (over - under >= 2) tips.push(`🔻 You overbid in ${over} of ${rounds} rounds. Try shaving 1 trick off any borderline bid — missing low usually costs less than missing high.`);
  else if (under - over >= 2) tips.push(`🔺 You underbid in ${under} of ${rounds} rounds (left points on the table). When you have an A or trump K, bid the extra trick.`);

  if (adv.nil.tries >= 2 && adv.nil.hits / adv.nil.tries < 0.5) tips.push(`🚫 Your nil bids hit ${adv.nil.hits}/${adv.nil.tries}. Before bidding 0, check you have a clear void or only very low cards in trump.`);
  else if (adv.nil.tries >= 2 && adv.nil.hits / adv.nil.tries === 1) tips.push(`🥇 Your nil bids are perfect (${adv.nil.hits}/${adv.nil.tries}). Keep using 0 as a weapon when your hand is genuinely weak.`);

  if (adv.bigHand.tries >= 2 && adv.bigHand.hits / adv.bigHand.tries < accuracy - 0.1) tips.push(`🎴 You're weaker in big-card rounds (${adv.bigHand.hits}/${adv.bigHand.tries}). With more cards, count expected tricks from aces, trumps, and short suits separately, then add.`);

  if (adv.dealer.tries >= 2 && adv.dealer.hits / adv.dealer.tries < accuracy - 0.15) tips.push(`🎲 Tough in the dealer seat (${adv.dealer.hits}/${adv.dealer.tries}). Remember the dealer is forbidden the one bid that would make totals = cards — plan a +1 or −1 escape bid in advance.`);

  if (adv.byTrump.length >= 2) {
    const best = adv.byTrump[0];
    const worst = adv.byTrump[adv.byTrump.length - 1];
    if (best.tries >= 2 && worst.tries >= 2 && (best.hits / best.tries) - (worst.hits / worst.tries) >= 0.3) {
      tips.push(`♠️ You read ${best.name} well (${best.hits}/${best.tries}) but struggle on ${worst.name} (${worst.hits}/${worst.tries}). For ${worst.name}, recount sure tricks before bidding.`);
    }
  }

  const halfDelta = adv.secondHalfPts - adv.firstHalfPts;
  if (rounds >= 4 && halfDelta <= -4) tips.push(`📉 You scored ${adv.firstHalfPts} early but only ${adv.secondHalfPts} late. Stamina dip? Slow down on small-hand rounds — they're high-variance.`);
  else if (rounds >= 4 && halfDelta >= 4) tips.push(`📈 Strong closer: ${adv.firstHalfPts} → ${adv.secondHalfPts}. Lean into bigger bids when leading late if the math allows.`);

  // Streak tip
  const hitPattern = game.history.map(h => h.bids[pi] === h.actuals[pi]);
  const lm = longestRun(hitPattern, false);
  if (lm >= 3) tips.push(`🧊 After ${lm} misses in a row, reset by bidding a safe 1–2 from your best certain tricks rather than chasing a hero round.`);

  if (adv.bidSkew >= 0.5) tips.push(`📈 You bid +${adv.bidSkew.toFixed(2)} above your fair share per round — aggressive. Make sure those extras are coming from actual sure-trick cards, not optimism.`);
  else if (adv.bidSkew <= -0.5) tips.push(`📉 You bid ${adv.bidSkew.toFixed(2)} below your fair share — conservative. Try bidding what your hand truly suggests; the +3 exact bonus rewards courage.`);

  if (adv.gapToLeader > 0 && rounds > 0) {
    const ppr = adv.avgPts;
    tips.push(`🎯 You finished ${adv.gapToLeader} pts behind the leader at avg ${(ppr>=0?'+':'')}${ppr.toFixed(2)} pts/round. To close that gap next game you need ~${(adv.gapToLeader/rounds).toFixed(2)} more pts/round.`);
  }

  if (!tips.length) tips.push(`✨ Balanced game across the board. Keep doing what you're doing, ${escapeHtml(name)}.`);
  return tips;
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

  // ---- Extra game-wide stats ----
  // Consistency leader (lowest std dev)
  let consist = null;
  game.players.forEach((p, i) => {
    const ds = game.history.map(h => h.deltas[i]);
    const m = ds.reduce((a, b) => a + b, 0) / ds.length;
    const v = ds.reduce((a, d) => a + (d - m) ** 2, 0) / ds.length;
    const sd = Math.sqrt(v);
    if (!consist || sd < consist.sd) consist = { name: p, sd };
  });
  if (consist) stats.push({ label: 'Mr. Consistent (lowest σ)', value: `${consist.name} ±${consist.sd.toFixed(2)}` });

  // Risk-taker: highest avg bid vs fair share (cards/N)
  let risk = { name: '—', skew: -Infinity };
  game.players.forEach((p, i) => {
    const s = game.history.reduce((acc, h) => acc + (h.bids[i] - h.cards / N), 0) / rounds;
    if (s > risk.skew) risk = { name: p, skew: s };
  });
  if (risk.skew > 0) stats.push({ label: 'Biggest risk-taker', value: `${risk.name} (+${risk.skew.toFixed(2)} vs fair share)` });

  // Clutch: best accuracy on big-card rounds
  const maxC = Math.max(...game.history.map(h => h.cards));
  const bigCutoff = Math.ceil(maxC / 2);
  const bigRounds = game.history.filter(h => h.cards >= bigCutoff);
  if (bigRounds.length >= 2) {
    let clutch = { name: '—', acc: -1, hits: 0, tries: bigRounds.length };
    game.players.forEach((p, i) => {
      const h = bigRounds.filter(r => r.bids[i] === r.actuals[i]).length;
      const acc = h / bigRounds.length;
      if (acc > clutch.acc) clutch = { name: p, acc, hits: h, tries: bigRounds.length };
    });
    stats.push({ label: `Clutch (≥${bigCutoff}-card rounds)`, value: `${clutch.name} ${clutch.hits}/${clutch.tries}` });
  }

  // Nil-bid specialist
  let nilBest = null;
  game.players.forEach((p, i) => {
    let tries = 0, hits = 0;
    game.history.forEach(h => { if (h.bids[i] === 0) { tries++; if (h.actuals[i] === 0) hits++; } });
    if (tries >= 2 && (!nilBest || hits / tries > nilBest.acc)) nilBest = { name: p, hits, tries, acc: hits / tries };
  });
  if (nilBest) stats.push({ label: 'Nil-bid specialist', value: `${nilBest.name} ${nilBest.hits}/${nilBest.tries}` });

  // Biggest comeback (largest improvement in rank from mid to end)
  if (rounds >= 4) {
    const mid = Math.floor(rounds / 2);
    const midTotals = game.history[mid - 1].totals;
    const endTotals = game.history[rounds - 1].totals;
    const rankAt = (totals, i) => [...totals.keys()].sort((a, b) => totals[b] - totals[a]).indexOf(i) + 1;
    let comeback = { name: '—', gain: 0 };
    game.players.forEach((p, i) => {
      const gain = rankAt(midTotals, i) - rankAt(endTotals, i);
      if (gain > comeback.gain) comeback = { name: p, gain };
    });
    if (comeback.gain > 0) stats.push({ label: 'Biggest comeback', value: `${comeback.name} (+${comeback.gain} places)` });
  }

  // Strongest trump for the field
  const trumpAcc = {};
  game.history.forEach(h => {
    const k = h.trump || h.trumpSym || '?';
    if (!trumpAcc[k]) trumpAcc[k] = { tries: 0, hits: 0 };
    h.bids.forEach((b, i) => { trumpAcc[k].tries++; if (b === h.actuals[i]) trumpAcc[k].hits++; });
  });
  const trumpEntries = Object.entries(trumpAcc).filter(([, v]) => v.tries >= N).map(([k, v]) => ({ name: k, pct: v.hits / v.tries }));
  if (trumpEntries.length >= 2) {
    trumpEntries.sort((a, b) => b.pct - a.pct);
    stats.push({ label: 'Easiest trump', value: `${trumpEntries[0].name} (${Math.round(trumpEntries[0].pct*100)}%)` });
    stats.push({ label: 'Hardest trump', value: `${trumpEntries[trumpEntries.length-1].name} (${Math.round(trumpEntries[trumpEntries.length-1].pct*100)}%)` });
  }

  return stats;
}

// -------- Share --------
async function copyShareLink() {
  const url = buildShareUrl();
  if (!url) return;
  let copied = false;
  try { await navigator.clipboard.writeText(url); copied = true; } catch {}
  showShareLinkPopup(url, copied ? '✓ Link copied — also shown here:' : 'Copy this link:');
  const status = $('share-status');
  if (status) { status.textContent = copied ? '✓ Link copied!' : 'Link shown above'; setTimeout(() => { status.textContent = ''; }, 6000); }
}

async function copyShortShareLink() {
  const url = buildShareUrl();
  if (!url) return;
  const status = $('share-status');
  if (status) status.textContent = 'Shortening…';
  // iOS Safari workaround: stash a promise into the clipboard inside the user-
  // activation window so writeText after await doesn't get silently rejected.
  let clipboardWritten = false;
  try {
    if (navigator.clipboard && typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
      const itemPromise = shortenUrl(url).then(s => new Blob([s], { type: 'text/plain' }));
      const item = new ClipboardItem({ 'text/plain': itemPromise });
      await navigator.clipboard.write([item]);
      clipboardWritten = true;
    }
  } catch {}
  let short;
  try { short = await shortenUrl(url); }
  catch (e) {
    if (status) status.textContent = '⚠️ Shortener failed';
    showShareLinkPopup(url, 'Shortener unavailable — copy this full link:');
    return;
  }
  if (!clipboardWritten) {
    try { await navigator.clipboard.writeText(short); clipboardWritten = true; } catch {}
  }
  // Always surface the short link onscreen so it's copy-able even if clipboard failed.
  showShareLinkPopup(short, clipboardWritten ? '✓ Short link copied — also shown here:' : 'Copy this short link:');
  if (status) {
    status.textContent = clipboardWritten ? ('✓ Short link copied: ' + short) : ('Short link: ' + short);
    setTimeout(() => { if (status) status.textContent = ''; }, 8000);
  }
}

function showShareLinkPopup(url, label) {
  let pop = document.getElementById('share-link-popup');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'share-link-popup';
    pop.className = 'share-link-popup';
    document.body.appendChild(pop);
  }
  pop.innerHTML = `
    <div class="share-link-popup-inner">
      <div class="share-link-popup-label">${escapeHtml(label)}</div>
      <input type="text" readonly value="${escapeHtml(url)}" />
      <div class="share-link-popup-actions">
        <button type="button" class="primary" data-act="copy">Copy</button>
        <a class="secondary" href="${escapeHtml(url)}" target="_blank" rel="noopener">Open</a>
        <button type="button" class="secondary" data-act="close">Close</button>
      </div>
    </div>`;
  pop.classList.add('show');
  const inp = pop.querySelector('input');
  setTimeout(() => { try { inp.focus(); inp.select(); } catch {} }, 30);
  pop.querySelector('[data-act="copy"]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); pop.querySelector('[data-act="copy"]').textContent = '✓ Copied'; }
    catch { try { inp.select(); document.execCommand('copy'); pop.querySelector('[data-act="copy"]').textContent = '✓ Copied'; } catch {} }
  });
  pop.querySelector('[data-act="close"]').addEventListener('click', () => pop.classList.remove('show'));
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
  $('quick-entry-btn-bottom').addEventListener('click', openQuickEntry);
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
