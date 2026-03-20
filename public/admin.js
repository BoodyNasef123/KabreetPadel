// =====================
//  Admin State
// =====================
let adminPin = '';
let players = [];
let courts = [];
let timeSlots = [];
let currentDate = new Date();
let socket;

// =====================
//  Helpers
// =====================
function formatDateKey(date) {
  return date.toISOString().split('T')[0];
}

function formatDateLabel(date) {
  const today = new Date();
  const key = formatDateKey(date);
  if (key === formatDateKey(today)) return 'Today';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast'; }, 3200);
}

function adminHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Admin-Pin': adminPin
  };
}

// =====================
//  Auth
// =====================
document.getElementById('loginBtn').addEventListener('click', login);
document.getElementById('adminPin').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});

async function login() {
  const pin = document.getElementById('adminPin').value;
  try {
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    if (res.ok) {
      adminPin = pin;
      sessionStorage.setItem('adminPin', pin);
      document.getElementById('loginScreen').style.display = 'none';
      document.getElementById('adminDashboard').style.display = 'block';
      initAdmin();
    } else {
      document.getElementById('loginError').style.display = 'block';
    }
  } catch {
    showToast('Network error', 'error');
  }
}

document.getElementById('logoutBtn').addEventListener('click', () => {
  adminPin = '';
  sessionStorage.removeItem('adminPin');
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('adminDashboard').style.display = 'none';
});

// Auto-login if session stored
const saved = sessionStorage.getItem('adminPin');
if (saved) {
  document.getElementById('adminPin').value = saved;
  login();
}

// =====================
//  Tabs
// =====================
document.querySelectorAll('.admin-tabs .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// =====================
//  Init
// =====================
async function initAdmin() {
  try {
    const metaRes = await fetch('/api/meta');
    const meta = await metaRes.json();
    courts = meta.courts;
    timeSlots = meta.timeSlots;
  } catch { /* ignore */ }

  loadPlayers();
  loadBookings();
  loadCourtsLock();
  loadScores();
  loadSettings();
  initSocket();
}

// =====================
//  Players Tab
// =====================
async function loadPlayers() {
  try {
    const res = await fetch('/api/admin/players', { headers: adminHeaders() });
    players = await res.json();
    renderPlayers();
  } catch { /* ignore */ }
}

function renderPlayers(filter = '') {
  const table = document.getElementById('playersTable');
  const filtered = filter
    ? players.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()))
    : players;

  if (filtered.length === 0) {
    table.innerHTML = '<p class="empty-state">No players found.</p>';
    return;
  }

  let html = `
    <div class="table-row table-header">
      <span class="col-name">Name</span>
      <span class="col-phone">Phone</span>
      <span class="col-status">Status</span>
      <span class="col-actions">Actions</span>
    </div>
  `;
  filtered.forEach(p => {
    html += `
      <div class="table-row ${!p.active ? 'row-inactive' : ''}">
        <span class="col-name">${p.name}</span>
        <span class="col-phone">${p.phone || '--'}</span>
        <span class="col-status">${p.active ? '<span class="badge-active">Active</span>' : '<span class="badge-inactive">Inactive</span>'}</span>
        <span class="col-actions">
          <button class="btn-icon" onclick="editPlayer('${p.id}')" title="Edit">✏️</button>
          ${p.active
            ? `<button class="btn-icon" onclick="deactivatePlayer('${p.id}')" title="Deactivate">🚫</button>`
            : `<button class="btn-icon" onclick="reactivatePlayer('${p.id}')" title="Reactivate">✅</button>`
          }
        </span>
      </div>
    `;
  });
  table.innerHTML = html;
}

document.getElementById('playerSearchAdmin').addEventListener('input', (e) => {
  renderPlayers(e.target.value);
});

document.getElementById('addPlayerAdminBtn').addEventListener('click', () => {
  const name = prompt('Player name:');
  if (!name) return;
  const phone = prompt('Phone (optional):') || '';
  addPlayer(name, phone);
});

async function addPlayer(name, phone) {
  try {
    const res = await fetch('/api/admin/players', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ name, phone })
    });
    if (res.ok) {
      showToast(`${name} added!`, 'success');
      loadPlayers();
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed', 'error');
    }
  } catch { showToast('Network error', 'error'); }
}

async function editPlayer(id) {
  const player = players.find(p => p.id === id);
  if (!player) return;
  const name = prompt('Name:', player.name);
  if (!name) return;
  const phone = prompt('Phone:', player.phone || '');

  try {
    const res = await fetch(`/api/admin/players/${id}`, {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ name, phone })
    });
    if (res.ok) {
      showToast('Updated', 'success');
      loadPlayers();
    } else {
      showToast('Failed to update', 'error');
    }
  } catch { showToast('Network error', 'error'); }
}

async function deactivatePlayer(id) {
  if (!confirm('Deactivate this player?')) return;
  try {
    const res = await fetch(`/api/admin/players/${id}`, {
      method: 'DELETE',
      headers: adminHeaders()
    });
    if (res.ok) { showToast('Deactivated', 'success'); loadPlayers(); }
  } catch { showToast('Network error', 'error'); }
}

async function reactivatePlayer(id) {
  try {
    const res = await fetch(`/api/admin/players/${id}`, {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ active: true })
    });
    if (res.ok) { showToast('Reactivated', 'success'); loadPlayers(); }
  } catch { showToast('Network error', 'error'); }
}

// Make functions globally available for inline onclick
window.editPlayer = editPlayer;
window.deactivatePlayer = deactivatePlayer;
window.reactivatePlayer = reactivatePlayer;

// =====================
//  Bookings Tab
// =====================
async function loadBookings() {
  const dateKey = formatDateKey(currentDate);
  document.getElementById('adminDateLabel').textContent = formatDateLabel(currentDate);

  try {
    const res = await fetch(`/api/bookings/${dateKey}`);
    const bookings = await res.json();
    renderBookings(bookings);
  } catch { /* ignore */ }
}

function renderBookings(bookings) {
  const table = document.getElementById('bookingsTable');
  let html = `
    <div class="table-row table-header">
      <span class="col-court">Court</span>
      <span class="col-time">Time</span>
      <span class="col-name">Player(s)</span>
      <span class="col-actions">Actions</span>
    </div>
  `;

  let hasBookings = false;
  courts.forEach(court => {
    const courtData = bookings[court] || {};
    timeSlots.forEach(slot => {
      const booking = courtData[slot];
      if (!booking) return;
      hasBookings = true;
      const names = booking.players ? booking.players.join(', ') : booking.name;
      html += `
        <div class="table-row">
          <span class="col-court">${court}</span>
          <span class="col-time">${slot}</span>
          <span class="col-name">${names}</span>
          <span class="col-actions">
            <button class="btn-icon" onclick="adminCancelBooking('${formatDateKey(currentDate)}','${court}','${slot}')" title="Cancel">❌</button>
          </span>
        </div>
      `;
    });
  });

  if (!hasBookings) {
    html += '<p class="empty-state">No bookings for this date.</p>';
  }

  table.innerHTML = html;
}

async function adminCancelBooking(date, court, slot) {
  if (!confirm(`Cancel booking for ${court} at ${slot}?`)) return;
  try {
    const res = await fetch('/api/admin/book', {
      method: 'DELETE',
      headers: adminHeaders(),
      body: JSON.stringify({ date, court, slot })
    });
    if (res.ok) { showToast('Booking cancelled', 'success'); loadBookings(); }
    else { showToast('Failed to cancel', 'error'); }
  } catch { showToast('Network error', 'error'); }
}
window.adminCancelBooking = adminCancelBooking;

document.getElementById('adminPrevDay').addEventListener('click', () => {
  currentDate.setDate(currentDate.getDate() - 1);
  loadBookings();
});
document.getElementById('adminNextDay').addEventListener('click', () => {
  currentDate.setDate(currentDate.getDate() + 1);
  loadBookings();
});

// =====================
//  Courts Lock Tab
// =====================
let lockDate = new Date();

async function loadCourtsLock() {
  document.getElementById('lockDateLabel').textContent = formatDateLabel(lockDate);
  const dateKey = formatDateKey(lockDate);

  try {
    const res = await fetch('/api/admin/settings', { headers: adminHeaders() });
    const data = await res.json();
    const locks = data.lockedSlots || {};
    renderCourtsLock(locks[dateKey] || {});
  } catch { /* ignore */ }
}

function renderCourtsLock(dateLocks) {
  const panel = document.getElementById('courtsLockPanel');
  let html = '';

  courts.forEach(court => {
    const isLocked = dateLocks[court] === true;
    html += `
      <div class="lock-card">
        <div class="lock-card-header">
          <span>${court}</span>
          <button class="btn btn-sm ${isLocked ? 'btn-danger' : 'btn-primary'}"
                  onclick="toggleCourtLock('${court}', ${isLocked})">
            ${isLocked ? 'Unlock' : 'Lock Entire Court'}
          </button>
        </div>
        <div class="lock-status">${isLocked ? '🔒 Locked' : '🔓 Open'}</div>
      </div>
    `;
  });

  panel.innerHTML = html;
}

async function toggleCourtLock(court, isCurrentlyLocked) {
  const dateKey = formatDateKey(lockDate);
  try {
    if (isCurrentlyLocked) {
      await fetch('/api/admin/lock', {
        method: 'DELETE',
        headers: adminHeaders(),
        body: JSON.stringify({ date: dateKey, court })
      });
      showToast(`${court} unlocked`, 'success');
    } else {
      await fetch('/api/admin/lock', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ date: dateKey, court })
      });
      showToast(`${court} locked`, 'success');
    }
    loadCourtsLock();
  } catch { showToast('Network error', 'error'); }
}
window.toggleCourtLock = toggleCourtLock;

document.getElementById('lockPrevDay').addEventListener('click', () => {
  lockDate.setDate(lockDate.getDate() - 1);
  loadCourtsLock();
});
document.getElementById('lockNextDay').addEventListener('click', () => {
  lockDate.setDate(lockDate.getDate() + 1);
  loadCourtsLock();
});

// =====================
//  Scores Tab
// =====================
let scoreDate = new Date();

async function loadScores() {
  document.getElementById('scoreDateLabel').textContent = formatDateLabel(scoreDate);
  const dateKey = formatDateKey(scoreDate);

  try {
    const res = await fetch(`/api/matches/${dateKey}`);
    const matches = await res.json();
    renderScores(matches);
  } catch { /* ignore */ }
}

function renderScores(matches) {
  const table = document.getElementById('scoresTable');
  const entries = Object.values(matches);

  if (entries.length === 0) {
    table.innerHTML = '<p class="empty-state">No matches recorded for this date.</p>';
    return;
  }

  let html = `
    <div class="table-row table-header">
      <span class="col-court">Court</span>
      <span class="col-time">Time</span>
      <span class="col-name">Teams</span>
      <span class="col-score">Score</span>
    </div>
  `;

  entries.forEach(m => {
    const scoreStr = m.scores ? m.scores.map(s => `${s[0]}-${s[1]}`).join(', ') : '--';
    const winnerStr = m.winner ? (m.winner === 'team1' ? (m.team1 || []).join(' & ') : (m.team2 || []).join(' & ')) : '';
    html += `
      <div class="table-row">
        <span class="col-court">${m.court}</span>
        <span class="col-time">${m.slot}</span>
        <span class="col-name">${(m.team1 || []).join(' & ')} vs ${(m.team2 || []).join(' & ')}</span>
        <span class="col-score">${scoreStr} ${winnerStr ? `(Winner: ${winnerStr})` : ''}</span>
      </div>
    `;
  });

  table.innerHTML = html;
}

document.getElementById('scorePrevDay').addEventListener('click', () => {
  scoreDate.setDate(scoreDate.getDate() - 1);
  loadScores();
});
document.getElementById('scoreNextDay').addEventListener('click', () => {
  scoreDate.setDate(scoreDate.getDate() + 1);
  loadScores();
});

// =====================
//  Settings Tab
// =====================
async function loadSettings() {
  try {
    const res = await fetch('/api/admin/settings', { headers: adminHeaders() });
    const data = await res.json();
    document.getElementById('settMaxBookings').value = data.settings?.maxBookingsPerPlayerPerDay || 3;
    document.getElementById('settBookingWindow').value = data.settings?.bookingWindowDays || 7;
  } catch { /* ignore */ }
}

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const settings = {
    maxBookingsPerPlayerPerDay: parseInt(document.getElementById('settMaxBookings').value) || 3,
    bookingWindowDays: parseInt(document.getElementById('settBookingWindow').value) || 7
  };
  const body = { settings };
  const newPin = document.getElementById('settPin').value.trim();
  if (newPin) {
    body.adminPin = newPin;
  }

  try {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify(body)
    });
    if (res.ok) {
      showToast('Settings saved!', 'success');
      if (newPin) {
        adminPin = newPin;
        sessionStorage.setItem('adminPin', newPin);
        document.getElementById('settPin').value = '';
      }
    } else {
      showToast('Failed to save', 'error');
    }
  } catch { showToast('Network error', 'error'); }
});

// =====================
//  Socket.io
// =====================
function initSocket() {
  socket = io();
  socket.on('bookingUpdate', () => loadBookings());
  socket.on('bookingCancel', () => loadBookings());
  socket.on('playerAdded', () => loadPlayers());
  socket.on('matchUpdate', () => loadScores());
  socket.on('locksUpdate', () => loadCourtsLock());
}
