// =====================
//  State
// =====================
let courts = [];
let timeSlots = [];
let bookings = {};
let matches = {};
let lockedSlots = {};
let currentDate = new Date();
let socket;
let players = [];
let selectedPlayer = null; // { id, name }
let navLocked = false;

// =====================
//  Helpers
// =====================
function formatDateKey(date) {
  return date.toISOString().split('T')[0];
}

function formatDateLabel(date) {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const key = formatDateKey(date);
  if (key === formatDateKey(today)) return 'Today';
  if (key === formatDateKey(tomorrow)) return 'Tomorrow';
  if (key === formatDateKey(yesterday)) return 'Yesterday';

  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatDateSubLabel(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function isSlotPast(slotStr) {
  const todayKey = formatDateKey(new Date());
  const currentKey = formatDateKey(currentDate);
  if (currentKey < todayKey) return true;
  if (currentKey > todayKey) return false;

  const startTime = slotStr.split(' - ')[0];
  const [h, m] = startTime.split(':').map(Number);
  const now = new Date();
  const slotDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  return slotDate <= now;
}

function isSlotLocked(court, slot) {
  const dateKey = formatDateKey(currentDate);
  const dateLocks = lockedSlots[dateKey];
  if (!dateLocks) return false;
  if (dateLocks[court] === true) return true;
  if (Array.isArray(dateLocks[court]) && dateLocks[court].includes(slot)) return true;
  return false;
}

function getPlayerName() {
  return selectedPlayer ? selectedPlayer.name : null;
}

function getPlayerId() {
  return selectedPlayer ? selectedPlayer.id : '';
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast'; }, 3200);
}

function timeAgo(isoString) {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// =====================
//  Clock
// =====================
function updateClock() {
  const now = new Date();
  document.getElementById('currentTime').textContent =
    now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  document.getElementById('currentDateInfo').textContent =
    now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// =====================
//  Login / Player Selection
// =====================
async function fetchPlayers() {
  try {
    const res = await fetch('/api/players');
    players = await res.json();
  } catch {
    players = [];
  }
}

function showLoginOverlay() {
  const overlay = document.getElementById('loginOverlay');
  const searchInput = document.getElementById('loginPlayerSearch');

  overlay.style.display = 'flex';
  searchInput.value = '';
  renderLoginList('', '');

  searchInput.oninput = () => {
    const raw = searchInput.value.trim();
    renderLoginList(raw.toLowerCase(), raw);
  };
  setTimeout(() => searchInput.focus(), 100);
}

function renderLoginList(query, rawQuery = query) {
  const list = document.getElementById('loginPlayerList');
  const active = players.filter(p => p.active !== false);
  const filtered = query
    ? active.filter(p => p.name.toLowerCase().includes(query))
    : active;

  let html = filtered.map(p =>
    `<button class="login-player-btn" data-id="${p.id}" data-name="${p.name}">
       <i data-lucide="user" class="icon"></i>${p.name}
     </button>`
  ).join('');

  // Show "Create account" option when search has text and no exact match
  if (query) {
    const exactMatch = active.find(p => p.name.toLowerCase() === query.toLowerCase());
    if (!exactMatch) {
      const escaped = rawQuery.replace(/"/g, '&quot;');
      html += `<button class="login-player-btn login-create-btn" data-name="${escaped}">
        <i data-lucide="user-plus" class="icon"></i>
        Create new user "<strong>${rawQuery}</strong>"
      </button>`;
    }
  }

  if (!html) {
    list.innerHTML = `<p style="text-align:center;color:var(--text-light);padding:16px 0;">No players registered yet.</p>`;
    return;
  }

  list.innerHTML = html;

  list.querySelectorAll('.login-player-btn:not(.login-create-btn)').forEach(btn => {
    btn.addEventListener('click', () => loginAs(btn.dataset.id, btn.dataset.name));
  });

  const createBtn = list.querySelector('.login-create-btn');
  if (createBtn) {
    createBtn.addEventListener('click', () => registerAndLogin(createBtn.dataset.name));
  }

  lucide.createIcons();
}

async function registerAndLogin(name) {
  const createBtn = document.querySelector('.login-create-btn');
  if (createBtn) {
    createBtn.disabled = true;
    createBtn.style.opacity = '0.6';
  }

  try {
    const res = await fetch('/api/players/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Could not create account', 'error');
      if (createBtn) { createBtn.disabled = false; createBtn.style.opacity = ''; }
      return;
    }
    players.push(data);
    loginAs(data.id, data.name);
    showToast(`Welcome, ${data.name}!`, 'success');
  } catch {
    showToast('Network error. Please try again.', 'error');
    if (createBtn) { createBtn.disabled = false; createBtn.style.opacity = ''; }
  }
}

function loginAs(id, name) {
  selectedPlayer = { id, name };
  localStorage.setItem('selectedPlayer', JSON.stringify(selectedPlayer));
  document.getElementById('loginOverlay').style.display = 'none';
  updateHeaderChip();
}

function updateHeaderChip() {
  const chip = document.getElementById('headerPlayerChip');
  const nameEl = document.getElementById('headerPlayerName');
  if (selectedPlayer) {
    nameEl.textContent = selectedPlayer.name;
    chip.style.display = 'flex';
  } else {
    chip.style.display = 'none';
  }
}

document.getElementById('headerPlayerChip').addEventListener('click', () => {
  // Switch player — show login overlay again
  selectedPlayer = null;
  localStorage.removeItem('selectedPlayer');
  updateHeaderChip();
  showLoginOverlay();
});

// =====================
//  UI - Date
// =====================
function updateDateDisplay() {
  const label = formatDateLabel(currentDate);
  const sublabel = formatDateSubLabel(currentDate);
  document.getElementById('dateLabel').textContent = label;
  document.getElementById('dateSubLabel').textContent =
    label === 'Today' || label === 'Tomorrow' || label === 'Yesterday' ? sublabel : '';
}

// =====================
//  UI - Skeleton
// =====================
function showSkeleton() {
  document.getElementById('loadingSpinner').style.display = 'none';
  document.getElementById('courtsGrid').style.display = 'none';
  let skeletonEl = document.getElementById('courtsSkeleton');
  if (!skeletonEl) {
    skeletonEl = document.createElement('div');
    skeletonEl.id = 'courtsSkeleton';
    skeletonEl.className = 'skeleton-grid';
    document.getElementById('courtsSection').prepend(skeletonEl);
  }
  const cols = courts.length || 2;
  skeletonEl.style.display = 'grid';
  skeletonEl.innerHTML = Array.from({ length: cols }).map(() => `
    <div class="skeleton-card">
      <div class="skeleton-header"></div>
      ${Array.from({ length: 4 }).map(() => '<div class="skeleton-slot"></div>').join('')}
    </div>
  `).join('');
}

function hideSkeleton() {
  const el = document.getElementById('courtsSkeleton');
  if (el) el.style.display = 'none';
}

// =====================
//  UI - Courts
// =====================
function renderCourts() {
  hideSkeleton();
  const grid = document.getElementById('courtsGrid');
  document.getElementById('loadingSpinner').style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = '';

  const dateMatches = matches || {};

  courts.forEach(court => {
    const courtBookings = bookings[court] || {};

    const card = document.createElement('div');
    card.className = 'court-card';
    card.innerHTML = `
      <div class="court-header">
        <i data-lucide="layout-grid" class="icon-lg court-icon"></i>
        <h2>${court}</h2>
      </div>
      <div class="court-slots" id="slots-${court.replace(/\s+/g, '-')}"></div>
    `;

    grid.appendChild(card);
    const slotsContainer = card.querySelector('.court-slots');

    timeSlots.forEach(slot => {
      const booking = courtBookings[slot];
      const past = isSlotPast(slot);
      const locked = isSlotLocked(court, slot);
      const matchKey = `${court}|${slot}`;
      const match = dateMatches[matchKey];

      let statusClass = 'available';
      let badge = 'Free';
      let nameText = 'Tap to book';
      let whenText = '';
      let scoreText = '';

      if (locked && !booking) {
        statusClass = 'locked';
        badge = 'Locked';
        nameText = 'Court locked';
      } else if (past && !booking) {
        statusClass = 'past';
        badge = 'Past';
        nameText = '';
      } else if (booking) {
        statusClass = 'booked';
        badge = 'Booked';
        const playersList = booking.players || [booking.name];
        nameText = playersList.join(', ');
        whenText = timeAgo(booking.bookedAt);
        if (match && (match.team1Sets !== undefined || match.team2Sets !== undefined)) {
          scoreText = `${match.team1Sets ?? 0}-${match.team2Sets ?? 0} sets`;
        }
      }

      const isClickable = (!past && !locked) || !!booking;
      const el = document.createElement('div');
      el.className = `slot ${statusClass}`;
      if (isClickable) {
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.setAttribute('aria-label', `${court} ${slot} — ${badge}`);
      }

      el.innerHTML = `
        <span class="slot-time">${slot}</span>
        <div class="slot-info">
          <div class="slot-name">${nameText}</div>
          ${scoreText ? `<div class="slot-score">${scoreText}</div>` : ''}
          ${whenText ? `<div class="slot-when">${whenText}</div>` : ''}
        </div>
        <span class="slot-badge">${badge}</span>
      `;

      if (isClickable) {
        el.addEventListener('click', () => openModal(court, slot, booking, match));
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openModal(court, slot, booking, match);
          }
        });
      }

      slotsContainer.appendChild(el);
    });
  });

  lucide.createIcons();
}

// =====================
//  Modal
// =====================
function openModal(court, slot, booking, match) {
  const overlay = document.getElementById('modalOverlay');
  const content = document.getElementById('modalContent');
  overlay.setAttribute('aria-hidden', 'false');

  if (booking) {
    showBookedModal(court, slot, booking, match, content);
  } else {
    showBookSlotModal(court, slot, content);
  }

  overlay.classList.add('active');
}

function showBookedModal(court, slot, booking, match, content) {
  const playersList = booking.players || [booking.name];
  const hasMatch = match && (match.team1Sets !== undefined || match.team2Sets !== undefined);

  content.innerHTML = `
    <h3>Slot Booked</h3>
    <p class="modal-subtitle">This slot is currently reserved.</p>
    <div class="modal-info">
      <strong>${court}</strong><br>
      ${slot}<br>
      Players: <strong>${playersList.join(', ')}</strong><br>
      ${booking.bookedAt ? `Reserved ${timeAgo(booking.bookedAt)}` : ''}
    </div>
    ${hasMatch ? `
      <div class="match-result">
        <div class="match-teams">
          <span class="${match.winner === 'team1' ? 'winner' : ''}">${(match.team1 || []).join(' & ')}</span>
          <span class="vs">vs</span>
          <span class="${match.winner === 'team2' ? 'winner' : ''}">${(match.team2 || []).join(' & ')}</span>
        </div>
        <div class="match-scores"><span>${match.team1Sets ?? 0} - ${match.team2Sets ?? 0} sets</span></div>
      </div>
    ` : ''}
    <div class="modal-actions">
      ${!isSlotPast(slot) ? `<button class="btn btn-danger" id="cancelBtn">Cancel This Booking</button>` : ''}
      <button class="btn btn-primary" id="scoreBtn">Log Match Score</button>
      <button class="btn btn-secondary" id="closeModalBtn">Close</button>
    </div>
  `;

  if (!isSlotPast(slot) && document.getElementById('cancelBtn')) {
    document.getElementById('cancelBtn').addEventListener('click', () => {
      const name = getPlayerName();
      const pid = getPlayerId();
      if (!name) {
        showToast('Log in first to cancel', 'error');
        closeModal();
        return;
      }
      showCancelConfirmModal(court, slot, booking, match, name, pid, content);
    });
  }

  document.getElementById('scoreBtn').addEventListener('click', () => {
    openScoreModal(court, slot, booking, match);
  });

  document.getElementById('closeModalBtn').addEventListener('click', closeModal);
}

function showCancelConfirmModal(court, slot, booking, match, name, pid, content) {
  const dateStr = currentDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  content.innerHTML = `
    <h3>Cancel Booking?</h3>
    <p class="modal-subtitle">This will free up the slot for others.</p>
    <div class="modal-info">
      <strong>${court}</strong><br>
      ${slot} · ${dateStr}<br>
      Cancelling as: <strong>${name}</strong>
    </div>
    <div class="modal-actions">
      <button class="btn btn-danger" id="confirmCancelBtn">Yes, Cancel</button>
      <button class="btn btn-secondary" id="backBtn">Go Back</button>
    </div>
  `;
  document.getElementById('confirmCancelBtn').addEventListener('click', () => {
    cancelBooking(court, slot, name, pid);
  });
  document.getElementById('backBtn').addEventListener('click', () => {
    showBookedModal(court, slot, booking, match, content);
  });
}

function showBookSlotModal(court, slot, content) {
  const name = getPlayerName();
  const dateStr = currentDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  content.innerHTML = `
    <h3>Book This Slot</h3>
    <p class="modal-subtitle">Reserve this court for your group.</p>
    <div class="modal-info">
      <strong>${court}</strong><br>
      ${slot} · ${dateStr}
    </div>
    ${!name
      ? `<p style="color:var(--red);font-size:0.85rem;margin-bottom:12px;">Please log in first to book a slot.</p>`
      : `<p style="font-size:0.9rem;margin-bottom:12px;">Booking as <strong>${name}</strong></p>`
    }
    <div class="modal-actions">
      <button class="btn btn-primary" id="confirmBookBtn" ${!name ? 'disabled style="opacity:0.5"' : ''}>
        Book as "${name || '...'}"
      </button>
      <button class="btn btn-secondary" id="closeModalBtn">Cancel</button>
    </div>
  `;

  if (name) {
    document.getElementById('confirmBookBtn').addEventListener('click', () => {
      showBookConfirmModal(court, slot, name, getPlayerId(), content);
    });
  }
  document.getElementById('closeModalBtn').addEventListener('click', closeModal);
}

function showBookConfirmModal(court, slot, name, playerId, content) {
  const dateStr = currentDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  content.innerHTML = `
    <h3>Confirm Booking</h3>
    <p class="modal-subtitle">Ready to reserve this slot?</p>
    <div class="modal-info">
      <strong>${court}</strong><br>
      ${slot} · ${dateStr}<br>
      Player: <strong>${name}</strong>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" id="finalBookBtn">Confirm Booking</button>
      <button class="btn btn-secondary" id="backBookBtn">Go Back</button>
    </div>
  `;
  document.getElementById('finalBookBtn').addEventListener('click', () => {
    makeBooking(court, slot, name, playerId);
  });
  document.getElementById('backBookBtn').addEventListener('click', () => {
    showBookSlotModal(court, slot, content);
  });
}

// =====================
//  Score Modal — doubles (2 per team required)
// =====================
function openScoreModal(court, slot, booking, existingMatch) {
  const content = document.getElementById('modalContent');
  const playersList = booking.players || [booking.name];

  // Pre-fill from existing match or booking players
  const t1p1 = existingMatch?.team1?.[0] || playersList[0] || '';
  const t1p2 = existingMatch?.team1?.[1] || playersList[1] || '';
  const t2p1 = existingMatch?.team2?.[0] || playersList[2] || '';
  const t2p2 = existingMatch?.team2?.[1] || playersList[3] || '';
  const existingT1Sets = existingMatch?.team1Sets ?? 0;
  const existingT2Sets = existingMatch?.team2Sets ?? 0;

  const allOpts = `<option value="">— Select —</option>` + players.map(p =>
    `<option value="${p.name}">${p.name}</option>`
  ).join('');

  content.innerHTML = `
    <h3>Log Match Score</h3>
    <p class="modal-subtitle">${court} · ${slot} &nbsp;·&nbsp; Best of 3 Sets</p>
    <div class="score-form">
      <div class="team-section">
        <label class="team-section-label-1">Team 1</label>
        <select id="t1p1" class="score-select">${allOpts}</select>
        <select id="t1p2" class="score-select">${allOpts}</select>
      </div>
      <div class="team-section">
        <label class="team-section-label-2">Team 2</label>
        <select id="t2p1" class="score-select">${allOpts}</select>
        <select id="t2p2" class="score-select">${allOpts}</select>
      </div>
      <div class="sets-section">
        <label>Sets won</label>
        <div class="set-row">
          <span>Team 1:</span>
          <input type="number" id="team1Sets" min="0" max="3" value="${existingT1Sets}">
          <span style="margin:0 8px">—</span>
          <span>Team 2:</span>
          <input type="number" id="team2Sets" min="0" max="3" value="${existingT2Sets}">
        </div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" id="saveScoreBtn">Save Score</button>
      <button class="btn btn-secondary" id="closeModalBtn">Cancel</button>
    </div>
  `;

  // Pre-select values
  if (t1p1) document.getElementById('t1p1').value = t1p1;
  if (t1p2) document.getElementById('t1p2').value = t1p2;
  if (t2p1) document.getElementById('t2p1').value = t2p1;
  if (t2p2) document.getElementById('t2p2').value = t2p2;

  document.getElementById('saveScoreBtn').addEventListener('click', async () => {
    const t1p1v = document.getElementById('t1p1').value;
    const t1p2v = document.getElementById('t1p2').value;
    const t2p1v = document.getElementById('t2p1').value;
    const t2p2v = document.getElementById('t2p2').value;

    if (!t1p1v || !t1p2v || !t2p1v || !t2p2v) {
      showToast('Each team needs exactly 2 players', 'error');
      return;
    }

    const team1 = [t1p1v, t1p2v];
    const team2 = [t2p1v, t2p2v];
    const team1Sets = parseInt(document.getElementById('team1Sets').value) || 0;
    const team2Sets = parseInt(document.getElementById('team2Sets').value) || 0;
    const winner = team1Sets > team2Sets ? 'team1' : team2Sets > team1Sets ? 'team2' : null;

    try {
      const res = await fetch('/api/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: formatDateKey(currentDate),
          court, slot, team1, team2, team1Sets, team2Sets, winner
        })
      });
      if (res.ok) {
        showToast('Score saved!', 'success');
        closeModal();
        fetchMatches();
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed to save score', 'error');
      }
    } catch {
      showToast('Network error', 'error');
    }
  });

  document.getElementById('closeModalBtn').addEventListener('click', closeModal);
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  document.getElementById('modalOverlay').setAttribute('aria-hidden', 'true');
}

document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    document.getElementById('leaderboardOverlay').classList.remove('active');
  }
});

// =====================
//  Leaderboard
// =====================
async function openLeaderboard() {
  const overlay = document.getElementById('leaderboardOverlay');
  const table = document.getElementById('leaderboardTable');
  table.innerHTML = '<p style="text-align:center;color:var(--text-light)">Loading...</p>';
  overlay.classList.add('active');

  try {
    const res = await fetch('/api/leaderboard');
    const data = await res.json();

    if (data.length === 0) {
      table.innerHTML = `
        <div class="empty-state">
          <i data-lucide="trophy" style="width:40px;height:40px;opacity:0.3;display:block;"></i>
          <p>No matches yet. Play a game and log the score!</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    let html = `
      <div class="lb-header">
        <span class="lb-rank">#</span>
        <span class="lb-name">Player</span>
        <span class="lb-w">W</span>
        <span class="lb-l">L</span>
        <span class="lb-pct">Win%</span>
      </div>
    `;
    data.forEach((p, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
      html += `
        <div class="lb-row ${i < 3 ? 'lb-top' : ''}">
          <span class="lb-rank">${medal}</span>
          <span class="lb-name">${p.name}</span>
          <span class="lb-w">${p.wins}</span>
          <span class="lb-l">${p.losses}</span>
          <span class="lb-pct">${p.winRate}%</span>
        </div>
      `;
    });
    table.innerHTML = html;
  } catch {
    table.innerHTML = '<p style="color:var(--red)">Failed to load leaderboard</p>';
  }
}

document.getElementById('leaderboardBtn').addEventListener('click', openLeaderboard);
document.getElementById('leaderboardClose').addEventListener('click', () => {
  document.getElementById('leaderboardOverlay').classList.remove('active');
});
document.getElementById('leaderboardOverlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('leaderboardOverlay')) {
    document.getElementById('leaderboardOverlay').classList.remove('active');
  }
});

// =====================
//  API Calls
// =====================
async function fetchBookings() {
  const dateKey = formatDateKey(currentDate);
  try {
    const res = await fetch(`/api/bookings/${dateKey}`);
    bookings = await res.json();
    renderCourts();
  } catch {
    hideSkeleton();
    showToast('Failed to load bookings', 'error');
  }
}

async function fetchMatches() {
  const dateKey = formatDateKey(currentDate);
  try {
    const res = await fetch(`/api/matches/${dateKey}`);
    matches = await res.json();
    renderCourts();
  } catch { /* ignore */ }
}

async function makeBooking(court, slot, name, playerId) {
  closeModal();
  const dateKey = formatDateKey(currentDate);
  try {
    const res = await fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateKey, court, slot, name, playerId })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Booked! ${court} at ${slot}`, 'success');
    } else {
      showToast(data.error || 'Could not book slot', 'error');
      fetchBookings();
    }
  } catch {
    showToast('Network error. Please try again.', 'error');
  }
}

async function cancelBooking(court, slot, name, playerId) {
  closeModal();
  const dateKey = formatDateKey(currentDate);
  try {
    const res = await fetch('/api/book', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateKey, court, slot, name, playerId })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Booking cancelled', 'success');
    } else {
      showToast(data.error || 'Could not cancel booking', 'error');
      fetchBookings();
    }
  } catch {
    showToast('Network error. Please try again.', 'error');
  }
}

// =====================
//  Date Navigation
// =====================
function lockNav(lock) {
  navLocked = lock;
  ['prevDay', 'nextDay'].forEach(id => {
    const btn = document.getElementById(id);
    btn.disabled = lock;
    btn.style.opacity = lock ? '0.4' : '';
  });
}

document.getElementById('prevDay').addEventListener('click', () => {
  if (navLocked) return;
  currentDate.setDate(currentDate.getDate() - 1);
  updateDateDisplay();
  showSkeleton();
  lockNav(true);
  Promise.all([fetchBookings(), fetchMatches()]).finally(() => lockNav(false));
});

document.getElementById('nextDay').addEventListener('click', () => {
  if (navLocked) return;
  currentDate.setDate(currentDate.getDate() + 1);
  updateDateDisplay();
  showSkeleton();
  lockNav(true);
  Promise.all([fetchBookings(), fetchMatches()]).finally(() => lockNav(false));
});

// =====================
//  Socket.io
// =====================
function initSocket() {
  socket = io();

  socket.on('bookingUpdate', ({ date, court, slot, booking }) => {
    if (date !== formatDateKey(currentDate)) return;
    if (!bookings[court]) bookings[court] = {};
    bookings[court][slot] = booking;
    renderCourts();
    const bookerName = booking.bookedBy || booking.name;
    if (bookerName !== getPlayerName()) {
      showToast(`${bookerName} just booked ${court} at ${slot}`);
    }
  });

  socket.on('bookingCancel', ({ date, court, slot }) => {
    if (date !== formatDateKey(currentDate)) return;
    if (bookings[court]) delete bookings[court][slot];
    renderCourts();
  });

  socket.on('matchUpdate', ({ date, court, slot, match }) => {
    if (date !== formatDateKey(currentDate)) return;
    const key = `${court}|${slot}`;
    matches[key] = match;
    renderCourts();
  });

  socket.on('locksUpdate', ({ date, lockedSlots: newLocks }) => {
    lockedSlots = newLocks;
    if (date === formatDateKey(currentDate)) renderCourts();
  });

  socket.on('playerAdded', (player) => {
    if (!players.find(p => p.id === player.id)) {
      players.push(player);
    }
  });

  socket.on('connect', () => {
    document.querySelector('.live-dot').style.background = '#2ecc71';
  });

  socket.on('disconnect', () => {
    document.querySelector('.live-dot').style.background = '#ff4757';
  });
}

// =====================
//  Init
// =====================
async function init() {
  updateDateDisplay();
  updateClock();
  setInterval(updateClock, 1000);

  try {
    const res = await fetch('/api/meta');
    const meta = await res.json();
    courts = meta.courts;
    timeSlots = meta.timeSlots;
    lockedSlots = meta.lockedSlots || {};
  } catch {
    showToast('Failed to load app data', 'error');
    return;
  }

  await fetchPlayers();

  // Restore saved player or prompt login
  const saved = localStorage.getItem('selectedPlayer');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // Verify player still exists and is active
      const stillActive = players.find(p => p.id === parsed.id && p.active !== false);
      if (stillActive) {
        selectedPlayer = parsed;
        updateHeaderChip();
      } else {
        // Player was deactivated — show login
        localStorage.removeItem('selectedPlayer');
        showLoginOverlay();
      }
    } catch {
      showLoginOverlay();
    }
  } else {
    showLoginOverlay();
  }

  // Load courts in parallel (visible behind login overlay if needed)
  showSkeleton();
  lockNav(true);
  await Promise.all([fetchBookings(), fetchMatches()]);
  lockNav(false);

  setInterval(() => {
    const todayKey = formatDateKey(new Date());
    if (formatDateKey(currentDate) === todayKey) renderCourts();
  }, 60000);

  lucide.createIcons();
  initSocket();
}

init();
