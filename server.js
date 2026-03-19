const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DATA_FILE = path.join(__dirname, 'bookings.json');
const PORT = process.env.PORT || 3000;

// Time slots: 8:00 AM to 10:00 PM, 1-hour slots
const TIME_SLOTS = [];
for (let h = 8; h < 22; h++) {
  const start = `${h.toString().padStart(2, '0')}:00`;
  const end = `${(h + 1).toString().padStart(2, '0')}:00`;
  TIME_SLOTS.push(`${start} - ${end}`);
}

const COURTS = ['Court 1', 'Court 2'];

function loadBookings() {
  if (!fs.existsSync(DATA_FILE)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveBookings(bookings) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(bookings, null, 2));
}

function getDateKey(date) {
  return date.toISOString().split('T')[0];
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Get all bookings for a specific date
app.get('/api/bookings/:date', (req, res) => {
  const bookings = loadBookings();
  const dateBookings = bookings[req.params.date] || {};
  res.json(dateBookings);
});

// Get metadata (courts, time slots)
app.get('/api/meta', (req, res) => {
  res.json({ courts: COURTS, timeSlots: TIME_SLOTS });
});

// Book a slot
app.post('/api/book', (req, res) => {
  const { date, court, slot, name } = req.body;

  if (!date || !court || !slot || !name || !name.trim()) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!COURTS.includes(court)) {
    return res.status(400).json({ error: 'Invalid court' });
  }

  if (!TIME_SLOTS.includes(slot)) {
    return res.status(400).json({ error: 'Invalid time slot' });
  }

  const bookings = loadBookings();
  if (!bookings[date]) bookings[date] = {};
  if (!bookings[date][court]) bookings[date][court] = {};

  if (bookings[date][court][slot]) {
    return res.status(409).json({ error: 'Slot already booked' });
  }

  bookings[date][court][slot] = {
    name: name.trim(),
    bookedAt: new Date().toISOString()
  };

  saveBookings(bookings);
  io.emit('bookingUpdate', { date, court, slot, booking: bookings[date][court][slot] });
  res.json({ success: true });
});

// Cancel a booking
app.delete('/api/book', (req, res) => {
  const { date, court, slot, name } = req.body;

  if (!date || !court || !slot || !name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const bookings = loadBookings();
  const existing = bookings[date]?.[court]?.[slot];

  if (!existing) {
    return res.status(404).json({ error: 'Booking not found' });
  }

  if (existing.name.toLowerCase() !== name.trim().toLowerCase()) {
    return res.status(403).json({ error: 'Name does not match the booking' });
  }

  delete bookings[date][court][slot];
  saveBookings(bookings);
  io.emit('bookingCancel', { date, court, slot });
  res.json({ success: true });
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎾 Kabreet Padel Booking App running!`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://<your-ip>:${PORT}\n`);
});
