// =====================
//  State
// =====================
let courts = [];
let timeSlots = [];
let bookings = {};
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

function getPlayerName() {
  return document.getElementById('playerName').value.trim();
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
//  UI
// =====================
function updateDateDisplay() {
  const label = formatDateLabel(currentDate);
  const sublabel = formatDateSubLabel(currentDate);
  document.getElementById('dateLabel').textContent = label;
  document.getElementById('dateSubLabel').textContent =
    label === 'Today' || label === 'Tomorrow' || label === 'Yesterday' ? sublabel : '';
}

function renderCourts() {
  const grid = document.getElementById('courtsGrid');
  const spinner = document.getElementById('loadingSpinner');
  spinner.style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = '';

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

      const el = document.createElement('div');

      let statusClass = 'available';
      let badge = 'Free';
      let nameText = 'Tap to book';
      let whenText = '';

      if (past && !booking) {
        statusClass = 'past';
        badge = 'Past';
        nameText = '';
      } else if (booking) {
        statusClass = 'booked';
        badge = 'Booked';
        nameText = booking.name;
        whenText = timeAgo(booking.bookedAt);
      }

      el.className = `slot ${statusClass}`;
      el.innerHTML = `
        <span class="slot-time">${slot}</span>
        <div class="slot-info">
          <div class="slot-name">${nameText}</div>
          ${whenText ? `<div class="slot-when">${whenText}</div>` : ''}
        </div>
        <span class="slot-badge">${badge}</span>
      `;

      if (!past) {
        el.addEventListener('click', () => openModal(court, slot, booking));
      }

      slotsContainer.appendChild(el);
    });
  });
}

// =====================
//  Modal
// =====================
function openModal(court, slot, booking) {
  const overlay = document.getElementById('modalOverlay');
  const content = document.getElementById('modalContent');

  if (booking) {
    // Show booking details & cancel option
    content.innerHTML = `
      <h3>Slot Booked</h3>
      <p class="modal-subtitle">This slot is currently reserved. You can cancel it if it's yours.</p>
      <div class="modal-info">
        <strong>${court}</strong><br>
        ${slot}<br>
        Booked by: <strong>${booking.name}</strong><br>
        ${booking.bookedAt ? `Reserved ${timeAgo(booking.bookedAt)}` : ''}
      </div>
      <div class="modal-actions">
        <button class="btn btn-danger" id="cancelBtn">Cancel This Booking</button>
        <button class="btn btn-secondary" id="closeModalBtn">Close</button>
      </div>
    `;

    document.getElementById('cancelBtn').addEventListener('click', () => {
      const name = getPlayerName();
      if (!name) {
        showToast('Enter your name first to cancel', 'error');
        closeModal();
        document.getElementById('playerName').focus();
        return;
      }
      cancelBooking(court, slot, name);
    });

    document.getElementById('closeModalBtn').addEventListener('click', closeModal);

  } else {
    // Book the slot
    const name = getPlayerName();
    content.innerHTML = `
      <h3>Book This Slot</h3>
      <p class="modal-subtitle">Reserve this court for yourself or your group.</p>
      <div class="modal-info">
        <strong>${court}</strong><br>
        ${slot}<br>
        ${formatDateLabel(currentDate)}
      </div>
      ${!name ? `<p style="color:#e74c3c;font-size:0.85rem;margin-bottom:12px;">Please enter your name above first.</p>` : ''}
      <div class="modal-actions">
        <button class="btn btn-primary" id="confirmBookBtn" ${!name ? 'disabled style="opacity:0.5"' : ''}>
          Book as "${name || '...'}"
        </button>
        <button class="btn btn-secondary" id="closeModalBtn">Cancel</button>
      </div>
    `;

    if (name) {
      document.getElementById('confirmBookBtn').addEventListener('click', () => {
        makeBooking(court, slot, name);
      });
    }

    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
  }

  overlay.classList.add('active');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
}

document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
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

async function makeBooking(court, slot, name) {
  closeModal();
  const dateKey = formatDateKey(currentDate);
  try {
    const res = await fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateKey, court, slot, name })
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

async function cancelBooking(court, slot, name) {
  closeModal();
  const dateKey = formatDateKey(currentDate);
  try {
    const res = await fetch('/api/book', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateKey, court, slot, name })
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
});

document.getElementById('nextDay').addEventListener('click', () => {
  currentDate.setDate(currentDate.getDate() + 1);
  updateDateDisplay();
  showSpinner();
  fetchBookings();
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
    if (booking.name !== getPlayerName()) {
      showToast(`${booking.name} just booked ${court} at ${slot}`);
    }
  });

  socket.on('bookingCancel', ({ date, court, slot }) => {
    if (date !== formatDateKey(currentDate)) return;
    if (bookings[court]) delete bookings[court][slot];
    renderCourts();
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
  try {
    const res = await fetch('/api/meta');
    const meta = await res.json();
    courts = meta.courts;
    timeSlots = meta.timeSlots;
  } catch {
    showToast('Failed to load app data', 'error');
    return;
  }

  await fetchBookings();

  // Refresh time-based "past" status every minute
  setInterval(() => {
    const todayKey = formatDateKey(new Date());
    const currentKey = formatDateKey(currentDate);
    if (currentKey === todayKey) renderCourts();
  }, 60000);

  initSocket();
}

init();
