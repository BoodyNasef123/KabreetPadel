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
  const [h] = startTime.split(':').map(Number);
  const now = new Date();
  const slotDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0);
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
  if (selectedPlayer) return selectedPlayer.name;
  return document.getElementById('playerSearch').value.trim();
}

function getPlayerId() {
  return selectedPlayer ? selectedPlayer.id : '';
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.className = 'toast';
  }, 3200);
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
//  Player Selector
// =====================
async function fetchPlayers() {
  try {
    const res = await fetch('/api/players');
    players = await res.json();
  } catch {
    players = [];
  }
}

function setupPlayerSelector() {
  const input = document.getElementById('playerSearch');
  const dropdown = document.getElementById('playerDropdown');
  const clearBtn = document.getElementById('clearPlayerBtn');

  // Restore from localStorage
  const saved = localStorage.getItem('selectedPlayer');
  if (saved) {
    try {
      selectedPlayer = JSON.parse(saved);
      showSelectedPlayer();
    } catch { selectedPlayer = null; }
  }

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (q.length === 0) {
      dropdown.style.display = 'none';
      return;
    }
    const filtered = players.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8);
    if (filtered.length === 0) {
      dropdown.innerHTML = `<div class="dropdown-empty">No players found. Ask an admin to register you.</div>`;
      dropdown.style.display = 'block';
      return;
    }
    dropdown.innerHTML = filtered.map(p =>
      `<div class="dropdown-item" data-id="${p.id}" data-name="${p.name}">${p.name}</div>`
    ).join('');
    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.dropdown-item').forEach(el => {
      el.addEventListener('click', () => {
        selectPlayer(el.dataset.id, el.dataset.name);
        dropdown.style.display = 'none';
        input.value = '';
      });
    });
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { dropdown.style.display = 'none'; }, 300);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) input.dispatchEvent(new Event('input'));
  });

  clearBtn.addEventListener('click', clearPlayer);
}

function selectPlayer(id, name) {
  selectedPlayer = { id, name };
  localStorage.setItem('selectedPlayer', JSON.stringify(selectedPlayer));
  showSelectedPlayer();
}

function showSelectedPlayer() {
  document.getElementById('selectedPlayerDisplay').style.display = 'flex';
  document.getElementById('selectedPlayerName').textContent = selectedPlayer.name;
  document.getElementById('playerSearch').style.display = 'none';
}

function clearPlayer() {
  selectedPlayer = null;
  localStorage.removeItem('selectedPlayer');
  document.getElementById('selectedPlayerDisplay').style.display = 'none';
  document.getElementById('playerSearch').style.display = 'block';
  document.getElementById('playerSearch').value = '';
}

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
//  UI - Courts
// =====================
function renderCourts() {
  const grid = document.getElementById('courtsGrid');
  const spinner = document.getElementById('loadingSpinner');
  spinner.style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = '';

  const dateKey = formatDateKey(currentDate);
  const dateMatches = matches || {};

  courts.forEach(court => {
    const courtBookings = bookings[court] || {};

    const card = document.createElement('div');
    card.className = 'court-card';

    card.innerHTML = `
      <div class="court-header">
        <span class="court-icon">🏓</span>
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

      const el = document.createElement('div');

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

      el.className = `slot ${statusClass}`;
      el.innerHTML = `
        <span class="slot-time">${slot}</span>
        <div class="slot-info">
          <div class="slot-name">${nameText}</div>
          ${scoreText ? `<div class="slot-score">${scoreText}</div>` : ''}
          ${whenText ? `<div class="slot-when">${whenText}</div>` : ''}
        </div>
        <span class="slot-badge">${badge}</span>
      `;

      if (!past && !locked) {
        el.addEventListener('click', () => openModal(court, slot, booking, match));
      } else if (booking) {
        el.addEventListener('click', () => openModal(court, slot, booking, match));
      }

      slotsContainer.appendChild(el);
    });
  });
}

// =====================
//  Modal
// =====================
function openModal(court, slot, booking, match) {
  const overlay = document.getElementById('modalOverlay');
  const content = document.getElementById('modalContent');

  if (booking) {
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
        if (!name && !pid) {
          showToast('Select your player first to cancel', 'error');
          closeModal();
          return;
        }
        cancelBooking(court, slot, name, pid);
      });
    }

    document.getElementById('scoreBtn').addEventListener('click', () => {
      openScoreModal(court, slot, booking, match);
    });

    document.getElementById('closeModalBtn').addEventListener('click', closeModal);

  } else {
    const name = getPlayerName();
    content.innerHTML = `
      <h3>Book This Slot</h3>
      <p class="modal-subtitle">Reserve this court for yourself or your group.</p>
      <div class="modal-info">
        <strong>${court}</strong><br>
        ${slot}<br>
        ${formatDateLabel(currentDate)}
      </div>
      ${!name ? `<p style="color:var(--red);font-size:0.85rem;margin-bottom:12px;">Please select a player above first.</p>` : ''}
      <div class="modal-actions">
        <button class="btn btn-primary" id="confirmBookBtn" ${!name ? 'disabled style="opacity:0.5"' : ''}>
          Book as "${name || '...'}"
        </button>
        <button class="btn btn-secondary" id="closeModalBtn">Cancel</button>
      </div>
    `;

    if (name) {
      document.getElementById('confirmBookBtn').addEventListener('click', () => {
        makeBooking(court, slot, name, getPlayerId());
      });
    }

    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
  }

  overlay.classList.add('active');
}

function openScoreModal(court, slot, booking, existingMatch) {
  const content = document.getElementById('modalContent');
  const playersList = booking.players || [booking.name];

  const t1p1 = existingMatch?.team1?.[0] || playersList[0] || '';
  const t1p2 = existingMatch?.team1?.[1] || playersList[1] || '';
  const t2p1 = existingMatch?.team2?.[0] || playersList[2] || '';
  const t2p2 = existingMatch?.team2?.[1] || playersList[3] || '';
  const existingT1Sets = existingMatch?.team1Sets ?? 0;
  const existingT2Sets = existingMatch?.team2Sets ?? 0;

  const allOpts = `<option value="">--</option>` + players.map(p => `<option value="${p.name}">${p.name}</option>`).join('');

  content.innerHTML = `
    <h3>Log Match Score</h3>
    <p class="modal-subtitle">${court} - ${slot}</p>
    <div class="score-form">
      <div class="team-section">
        <label>Team 1</label>
        <select id="t1p1" class="score-select">${allOpts}</select>
        <select id="t1p2" class="score-select">${allOpts}</select>
      </div>
      <div class="team-section">
        <label>Team 2</label>
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

  // Pre-select player values
  if (t1p1) document.getElementById('t1p1').value = t1p1;
  if (t1p2) document.getElementById('t1p2').value = t1p2;
  if (t2p1) document.getElementById('t2p1').value = t2p1;
  if (t2p2) document.getElementById('t2p2').value = t2p2;

  document.getElementById('saveScoreBtn').addEventListener('click', async () => {
    const team1 = [document.getElementById('t1p1').value, document.getElementById('t1p2').value].filter(Boolean);
    const team2 = [document.getElementById('t2p1').value, document.getElementById('t2p2').value].filter(Boolean);
    const team1Sets = parseInt(document.getElementById('team1Sets').value) || 0;
    const team2Sets = parseInt(document.getElementById('team2Sets').value) || 0;

    if (team1.length === 0 || team2.length === 0) {
      showToast('Please select at least one player per team', 'error');
      return;
    }

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
}

document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
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
      table.innerHTML = '<p style="text-align:center;color:var(--text-light);padding:20px;">No matches recorded yet. Play some games and log scores!</p>';
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
document.getElementById('prevDay').addEventListener('click', () => {
  currentDate.setDate(currentDate.getDate() - 1);
  updateDateDisplay();
  showSpinner();
  fetchBookings();
  fetchMatches();
});

document.getElementById('nextDay').addEventListener('click', () => {
  currentDate.setDate(currentDate.getDate() + 1);
  updateDateDisplay();
  showSpinner();
  fetchBookings();
  fetchMatches();
});

function showSpinner() {
  document.getElementById('loadingSpinner').style.display = 'flex';
  document.getElementById('courtsGrid').style.display = 'none';
}

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
  setupPlayerSelector();

  await Promise.all([fetchBookings(), fetchMatches()]);

  // Refresh time-based "past" status every minute
  setInterval(() => {
    const todayKey = formatDateKey(new Date());
    const currentKey = formatDateKey(currentDate);
    if (currentKey === todayKey) renderCourts();
  }, 60000);

  initSocket();
}

init();
