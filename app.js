// Contract Whist Tracker
// Scoring: +3 + bid if exact; -|actual - bid| if missed
// Trumps cycle: ♠ ♥ ♣ ♦ NT
// Dealer rotates: round R dealer = (firstDealerIdx + R) % N
// Bidding order: player to LEFT of dealer bids first; dealer bids LAST.
// Last bidder (dealer) is constrained: total bids must NOT equal cards.

const SUITS = [
  { sym: '♠', name: 'Spades', cls: 'suit-black' },
  { sym: '♥', name: 'Hearts', cls: 'suit-red' },
  { sym: '♣', name: 'Clubs', cls: 'suit-black' },
  { sym: '♦', name: 'Diamonds', cls: 'suit-red' },
  { sym: 'NT', name: 'No Trump', cls: 'suit-nt' },
];

const STORAGE_KEY = 'whist_history_v1';
const ACTIVE_KEY = 'whist_active_v2';

const $ = (id) => document.getElementById(id);

let state = null;
let chartInstance = null;
let setupSelectedStarter = 'random'; // index or 'random'

// -------- Setup view --------
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
  // Default to max whenever player count changes, unless user has manually edited
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

  state = {
    id: Date.now(),
    startedAt: new Date().toISOString(),
    players,
    startCards: start,
    direction: dir,
    rounds,
    firstDealer,
    currentRound: 0,
    phase: 'bidding', // 'bidding' | 'playing'
    history: [],
    pendingBids: players.map(() => 0),
    pendingActuals: players.map(() => 0),
    activeBidder: 0, // index within bidOrder array; first to bid = left of dealer
  };
  saveActive();
  showView('game');
  renderGame();
}

// -------- Game view --------
function trumpFor(roundIdx) { return SUITS[roundIdx % SUITS.length]; }
function dealerForRound(roundIdx) { return (state.firstDealer + roundIdx) % state.players.length; }

// Bid order for a round: player to LEFT of dealer first, dealer last.
// In setup seat order, "left" = next index (i+1 mod N).
function bidOrderForRound(roundIdx) {
  const N = state.players.length;
  const dealer = dealerForRound(roundIdx);
  const order = [];
  for (let i = 1; i <= N; i++) order.push((dealer + i) % N); // dealer+1 first, dealer last
  return order;
}

function totals() {
  const t = state.players.map(() => 0);
  for (const r of state.history) for (let i = 0; i < t.length; i++) t[i] += r.deltas[i];
  return t;
}

function totalsAfter(historySlice) {
  const t = state.players.map(() => 0);
  for (const r of historySlice) for (let i = 0; i < t.length; i++) t[i] += r.deltas[i];
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
  const N = state.players.length;

  // Header
  let html = '<thead><tr><th class="round-cell">Round</th>';
  state.players.forEach((p, i) => {
    const isDealer = i === dealerIdx;
    html += `<th class="${isDealer ? 'dealer-col' : ''}">${escapeHtml(p)}${isDealer ? '<div class="dealer-pill">DEALER</div>' : ''}</th>`;
  });
  html += '</tr></thead><tbody>';

  // Historical rounds
  state.history.forEach((r, ri) => {
    const rTrump = SUITS.find(s => s.name === r.trump);
    const rDealer = dealerForRound(ri);
    html += `<tr><td class="round-cell">
      <div><span class="cards-num">${r.cards}</span><span class="trump-sym ${rTrump.cls}">${rTrump.sym}</span></div>
      <small>R${ri + 1}</small>
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
  const order = bidOrderForRound(idx);
  const lastBidderIdx = order[order.length - 1]; // = dealer
  const curTotals = totals();
  html += `<tr class="current-row"><td class="round-cell">
    <div><span class="cards-num">${cards}</span><span class="trump-sym ${trump.cls}">${trump.sym}</span></div>
    <small>R${idx + 1} (now)</small>
  </td>`;
  state.players.forEach((p, pi) => {
    const isDealer = pi === dealerIdx;
    let cell = '';
    if (state.phase === 'bidding') {
      // Bid input + running total
      const b = state.pendingBids[pi];
      cell = `<div class="cell-stack">
        <input type="number" inputmode="numeric" pattern="[0-9]*" class="cell-input" min="0" max="${cards}"
          value="${b}" data-bid="${pi}" />
        <span class="cell-total">${curTotals[pi]}</span>
      </div>`;
    } else {
      // Show bid as indicator, actual input, delta preview
      const b = state.pendingBids[pi];
      const a = state.pendingActuals[pi];
      const delta = scoreFor(b, a);
      const ok = b === a;
      const dStr = (delta >= 0 ? '+' : '') + delta;
      cell = `<div class="cell-stack">
        <span class="bid-with-delta">
          <span class="bid-result ${ok ? 'bid-correct' : 'bid-miss'}">${b}</span><sup class="delta-sup ${delta >= 0 ? 'pos' : 'neg'}">${dStr}</sup>
        </span>
        <input type="number" inputmode="numeric" pattern="[0-9]*" class="cell-input" min="0" max="${cards}"
          value="${a}" data-actual="${pi}" />
        <span class="cell-total">${curTotals[pi] + delta}</span>
      </div>`;
    }
    html += `<td class="${isDealer ? 'dealer-col' : ''}">${cell}</td>`;
  });
  html += '</tr></tbody>';
  table.innerHTML = html;

  // Bind inputs
  table.querySelectorAll('input[data-bid]').forEach((inp) => {
    inp.addEventListener('input', () => {
      state.pendingBids[+inp.dataset.bid] = clampInt(inp.value, 0, cards);
      updateBidWarning(inp);
    });
    inp.addEventListener('focus', () => updateBidWarning(inp));
    inp.addEventListener('blur', () => updateBidWarning(null));
  });
  table.querySelectorAll('input[data-actual]').forEach((inp) => {
    inp.addEventListener('input', () => {
      state.pendingActuals[+inp.dataset.actual] = clampInt(inp.value, 0, cards);
      renderGame(); // refresh deltas/totals preview
      // try to keep focus
      const sel = table.querySelector(`input[data-actual="${inp.dataset.actual}"]`);
      if (sel) sel.focus();
    });
  });

  $('lock-bids').classList.toggle('hidden', state.phase !== 'bidding');
  $('commit-round').classList.toggle('hidden', state.phase !== 'playing');
  updateBidWarning(null);
}

function scoreFor(bid, actual) {
  if (bid === actual) return 3 + bid;
  return -Math.abs(actual - bid);
}

function updateBidWarning(focusedInput) {
  const warn = $('bid-warning');
  if (state.phase !== 'bidding') {
    // In playing phase, optionally show running tricks
    const cards = state.rounds[state.currentRound];
    const sum = state.pendingActuals.reduce((a, b) => a + b, 0);
    warn.className = 'bid-warning info';
    warn.textContent = `Tricks entered: ${sum} / ${cards}`;
    return;
  }
  const cards = state.rounds[state.currentRound];
  const order = bidOrderForRound(state.currentRound);
  const lastBidderIdx = order[order.length - 1];

  // Only show warning when the LAST bidder's input is focused
  if (focusedInput && +focusedInput.dataset.bid === lastBidderIdx) {
    const otherSum = state.pendingBids.reduce((acc, b, i) => i === lastBidderIdx ? acc : acc + b, 0);
    const forbidden = cards - otherSum;
    const cur = state.pendingBids[lastBidderIdx];
    if (cur === forbidden) {
      warn.className = 'bid-warning';
      warn.textContent = `⚠️ Dealer (${state.players[lastBidderIdx]}) cannot bid ${forbidden} — total bids would equal cards (${cards}).`;
    } else {
      warn.className = 'bid-warning info';
      warn.textContent = `Others bid ${otherSum}. Dealer cannot bid ${forbidden} (would total ${cards}).`;
    }
  } else {
    warn.className = 'bid-warning info';
    warn.textContent = '';
  }
}

function lockBids() {
  const cards = state.rounds[state.currentRound];
  for (const b of state.pendingBids) if (b < 0 || b > cards) { alert('Bid out of range'); return; }
  const order = bidOrderForRound(state.currentRound);
  const lastBidderIdx = order[order.length - 1];
  const sum = state.pendingBids.reduce((a, b) => a + b, 0);
  if (sum === cards) {
    if (!confirm(`Total bids equal cards (${cards}). Dealer (${state.players[lastBidderIdx]}) shouldn't be allowed this. Continue anyway?`)) return;
  }
  state.phase = 'playing';
  state.pendingActuals = state.players.map(() => 0);
  saveActive();
  renderGame();
}

function commitRound() {
  const cards = state.rounds[state.currentRound];
  const sum = state.pendingActuals.reduce((a, b) => a + b, 0);
  if (sum !== cards) {
    if (!confirm(`Tricks won total ${sum} but there are ${cards} cards. Save anyway?`)) return;
  }
  const deltas = state.pendingBids.map((b, i) => scoreFor(b, state.pendingActuals[i]));
  const prev = state.history.length ? state.history[state.history.length - 1].totals : state.players.map(() => 0);
  const newTotals = prev.map((t, i) => t + deltas[i]);
  state.history.push({
    cards,
    trump: trumpFor(state.currentRound).name,
    trumpSym: trumpFor(state.currentRound).sym,
    bids: [...state.pendingBids],
    actuals: [...state.pendingActuals],
    deltas,
    totals: newTotals,
  });
  state.currentRound += 1;
  state.phase = 'bidding';
  state.pendingBids = state.players.map(() => 0);
  state.pendingActuals = state.players.map(() => 0);
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
  state.currentRound -= 1;
  state.pendingBids = [...last.bids];
  state.pendingActuals = [...last.actuals];
  state.phase = 'bidding';
  saveActive();
  renderGame();
}

// -------- Finish / Summary --------
function finishGame() {
  const finished = { ...state, finishedAt: new Date().toISOString() };
  const list = loadHistory();
  list.unshift(finished);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  sessionStorage.removeItem(ACTIVE_KEY);
  state = finished;
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
  $('winner-banner').innerHTML = `🏆 Winner: <b>${escapeHtml(winner.name)}</b> with ${winner.score} points`;

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
    <thead><tr><th>Rank</th><th>Player</th><th>Score</th><th>Correct bids</th><th>Best round</th></tr></thead>
    <tbody>
      ${ranked.map((r, i) => {
        const correct = game.history.filter(h => h.bids[r.idx] === h.actuals[r.idx]).length;
        const best = game.history.reduce((m, h) => Math.max(m, h.deltas[r.idx]), -Infinity);
        return `<tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(r.name)}</td>
          <td><b>${r.score}</b></td>
          <td>${correct} / ${game.history.length}</td>
          <td>${best === -Infinity ? '—' : (best >= 0 ? '+' : '') + best}</td>
        </tr>`;
      }).join('')}
    </tbody>`;
}

function computeStats(game) {
  const stats = [];
  const rounds = game.history.length;
  if (!rounds) return [{ label: 'Rounds played', value: 0 }];

  const accuracy = game.players.map((p, i) => ({
    name: p,
    correct: game.history.filter(h => h.bids[i] === h.actuals[i]).length,
  }));
  accuracy.sort((a, b) => b.correct - a.correct);
  stats.push({ label: 'Most accurate', value: `${accuracy[0].name} (${accuracy[0].correct}/${rounds})` });

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

  const totalBids = game.history.reduce((a, h) => a + h.bids.reduce((x, y) => x + y, 0), 0);
  const totalCards = game.history.reduce((a, h) => a + h.cards, 0);
  stats.push({ label: 'Net over/under-bid', value: `${(totalBids - totalCards >= 0 ? '+' : '')}${(totalBids - totalCards)} tricks` });

  let leadChanges = 0, lastLead = -1;
  game.history.forEach(h => {
    let leader = 0;
    h.totals.forEach((t, i) => { if (t > h.totals[leader]) leader = i; });
    if (lastLead !== -1 && leader !== lastLead) leadChanges++;
    lastLead = leader;
  });
  stats.push({ label: 'Lead changes', value: leadChanges });

  stats.push({ label: 'Rounds played', value: rounds });

  return stats;
}

// -------- History view --------
function loadHistory() {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function renderHistory() {
  const list = $('history-list');
  const games = loadHistory();
  if (!games.length) { list.innerHTML = '<p style="color:var(--muted)">No games saved this session yet.</p>'; return; }
  list.innerHTML = '';
  games.forEach((g, idx) => {
    const totals = g.history.length ? g.history[g.history.length - 1].totals : g.players.map(() => 0);
    const ranked = g.players.map((p, i) => ({ name: p, score: totals[i] })).sort((a, b) => b.score - a.score);
    const card = document.createElement('div');
    card.className = 'history-card';
    card.innerHTML = `
      <div>
        <h4>${escapeHtml(ranked[0].name)} won (${ranked[0].score})</h4>
        <div class="history-meta">
          ${new Date(g.startedAt).toLocaleString()} ·
          ${g.players.length} players · ${g.history.length} rounds
        </div>
      </div>
      <button class="secondary" data-view="${idx}">View</button>
    `;
    list.appendChild(card);
  });
  list.querySelectorAll('button[data-view]').forEach(b => b.addEventListener('click', () => {
    const idx = +b.dataset.view;
    state = games[idx];
    // Ensure firstDealer exists on legacy entries
    if (state.firstDealer == null) state.firstDealer = 0;
    renderSummary(state);
    showView('summary');
  }));
}

// -------- Utility --------
function saveActive() { sessionStorage.setItem(ACTIVE_KEY, JSON.stringify(state)); }
function clampInt(v, min, max) { let n = parseInt(v, 10); if (isNaN(n)) n = min; return Math.max(min, Math.min(max, n)); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

function showView(name) {
  ['setup', 'game', 'summary', 'history'].forEach(v => $('view-' + v).classList.toggle('hidden', v !== name));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (name === 'history') $('nav-history').classList.add('active');
  else if (name === 'setup') $('nav-new').classList.add('active');
}

// -------- Init --------
function init() {
  $('setup-players').addEventListener('input', renderPlayerNames);
  renderPlayerNames();
  $('start-game').addEventListener('click', startGame);
  $('lock-bids').addEventListener('click', lockBids);
  $('commit-round').addEventListener('click', commitRound);
  $('undo-round').addEventListener('click', undoLastRound);
  $('end-game-btn').addEventListener('click', endGameEarly);
  $('play-again').addEventListener('click', () => { state = null; sessionStorage.removeItem(ACTIVE_KEY); showView('setup'); });
  $('view-history-btn').addEventListener('click', () => { renderHistory(); showView('history'); });
  $('nav-new').addEventListener('click', () => {
    if (state && state.history && state.currentRound < state.rounds.length) {
      if (!confirm('Abandon current game?')) return;
      sessionStorage.removeItem(ACTIVE_KEY);
      state = null;
    }
    showView('setup');
  });
  $('nav-history').addEventListener('click', () => { renderHistory(); showView('history'); });
  $('clear-history').addEventListener('click', () => {
    if (confirm('Clear all saved games?')) { sessionStorage.removeItem(STORAGE_KEY); renderHistory(); }
  });

  const active = sessionStorage.getItem(ACTIVE_KEY);
  if (active) {
    try {
      state = JSON.parse(active);
      if (state && state.currentRound < state.rounds.length) {
        showView('game');
        renderGame();
        return;
      }
    } catch {}
  }
  showView('setup');
}

document.addEventListener('DOMContentLoaded', init);
