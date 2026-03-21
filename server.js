const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const store = require('./dataStore');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Time slots: 48 half-hour slots
const TIME_SLOTS = [];
for (let m = 0; m < 24 * 60; m += 30) {
  const startH = Math.floor(m / 60);
  const startM = m % 60;
  const endTotal = m + 30;
  const endH = Math.floor(endTotal / 60) % 24;
  const endMin = endTotal % 60;
  const start = `${startH.toString().padStart(2, '0')}:${startM.toString().padStart(2, '0')}`;
  const end = `${endH.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')}`;
  TIME_SLOTS.push(`${start} - ${end}`);
}

function getCourts() {
  const admin = store.loadAdmin();
  return admin.courts || ['Court 1', 'Court 2'];
}

function getSettings() {
  const admin = store.loadAdmin();
  return admin.settings || {};
}

// =====================
//  Middleware
// =====================
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function requireAdmin(req, res, next) {
  const pin = req.headers['x-admin-pin'];
  const admin = store.loadAdmin();
  if (!pin || pin !== admin.adminPin) {
    return res.status(401).json({ error: 'Invalid admin PIN' });
  }
  next();
}

// =====================
//  Booking stats helper
// =====================
function computeStats(date) {
  const bookings = store.loadBookings();
  const dateBookings = bookings[date] || {};
  const courts = getCourts();
  const now = new Date();
  const todayKey = now.toISOString().split('T')[0];
  const stats = {};
  let allPlayers = [];

  courts.forEach(court => {
    const courtData = dateBookings[court] || {};
    let booked = 0, past = 0;
    TIME_SLOTS.forEach(slot => {
      if (courtData[slot]) {
        booked++;
        const names = courtData[slot].players || [courtData[slot].name];
        allPlayers.push(...names);
      } else if (date === todayKey) {
        const [, endTime] = slot.split(' - ');
        const [endH, endM] = endTime.split(':').map(Number);
        const endMins = (endH === 0 && endM === 0) ? 1440 : endH * 60 + endM;
        if (endMins <= now.getHours() * 60 + now.getMinutes()) past++;
      } else if (date < todayKey) {
        past++;
      }
    });
    stats[court] = {
      total: TIME_SLOTS.length,
      booked,
      past: date > todayKey ? 0 : past,
      available: TIME_SLOTS.length - booked - (date > todayKey ? 0 : past)
    };
  });

  return {
    courts: stats,
    totalBookings: allPlayers.length,
    uniquePlayers: [...new Set(allPlayers.map(n => n.toLowerCase()))].length
  };
}

// =====================
//  Public API routes
// =====================

// Meta
app.get('/api/meta', (req, res) => {
  const admin = store.loadAdmin();
  res.json({
    courts: getCourts(),
    timeSlots: TIME_SLOTS,
    lockedSlots: admin.lockedSlots || {}
  });
});

// Players
app.get('/api/players', (req, res) => {
  const { players } = store.loadPlayers();
  res.json(players.filter(p => p.active));
});

// Self-registration: anyone can create an account
app.post('/api/players/register', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters' });
  const player = store.createPlayer(name);
  if (!player) return res.status(409).json({ error: 'A player with that name already exists' });
  io.emit('playerAdded', player);
  res.json(player);
});


// Bookings
app.get('/api/bookings/:date', (req, res) => {
  const bookings = store.loadBookings();
  const dateBookings = bookings[req.params.date] || {};
  res.json(dateBookings);
});

// Stats
app.get('/api/stats/:date', (req, res) => {
  res.json(computeStats(req.params.date));
});

// Weather

// Book a slot
app.post('/api/book', (req, res) => {
  const { date, court, slot, name, playerId, players: playerNames } = req.body;
  const courts = getCourts();
  const settings = getSettings();

  if (!date || !court || !slot) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!courts.includes(court)) {
    return res.status(400).json({ error: 'Invalid court' });
  }
  if (!TIME_SLOTS.includes(slot)) {
    return res.status(400).json({ error: 'Invalid time slot' });
  }
  if (store.isSlotLocked(date, court, slot)) {
    return res.status(403).json({ error: 'This slot is locked by admin' });
  }

  // Resolve booking name(s)
  let bookerName = '';
  let bookerPlayerId = '';
  let playerList = [];

  if (playerId) {
    const player = store.getPlayerById(playerId);
    if (!player) return res.status(400).json({ error: 'Player not found' });
    bookerName = player.name;
    bookerPlayerId = playerId;
    playerList = [player.name];
  } else if (name && name.trim()) {
    bookerName = name.trim();
    playerList = [bookerName];
  } else {
    return res.status(400).json({ error: 'Player selection required' });
  }

  if (playerNames && Array.isArray(playerNames)) {
    playerList = playerNames;
  }

  // Booking window check
  if (settings.bookingWindowDays) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const bookDate = new Date(date + 'T00:00:00');
    const diffDays = Math.ceil((bookDate - today) / (1000 * 60 * 60 * 24));
    if (diffDays > settings.bookingWindowDays) {
      return res.status(400).json({ error: `Can only book up to ${settings.bookingWindowDays} days in advance` });
    }
  }

  const bookings = store.loadBookings();
  if (!bookings[date]) bookings[date] = {};
  if (!bookings[date][court]) bookings[date][court] = {};

  if (bookings[date][court][slot]) {
    return res.status(409).json({ error: 'Slot already booked' });
  }

  // Max bookings per player per day check
  if (settings.maxBookingsPerPlayerPerDay && bookerName) {
    let count = 0;
    courts.forEach(c => {
      const courtSlots = bookings[date]?.[c] || {};
      Object.values(courtSlots).forEach(b => {
        if (b.bookedBy?.toLowerCase() === bookerName.toLowerCase() ||
            b.name?.toLowerCase() === bookerName.toLowerCase()) {
          count++;
        }
      });
    });
    if (count >= settings.maxBookingsPerPlayerPerDay) {
      return res.status(400).json({ error: `Max ${settings.maxBookingsPerPlayerPerDay} bookings per day` });
    }
  }

  const booking = {
    name: bookerName,
    bookedBy: bookerName,
    playerId: bookerPlayerId || undefined,
    players: playerList,
    bookedAt: new Date().toISOString()
  };

  bookings[date][court][slot] = booking;
  store.saveBookings(bookings);
  store.addLog({ event: 'booking_made', playerName: bookerName, court, slot, date });

  io.emit('bookingUpdate', { date, court, slot, booking });
  io.emit('statsUpdate', { date, stats: computeStats(date) });
  res.json({ success: true });
});

// Cancel a booking
app.delete('/api/book', (req, res) => {
  const { date, court, slot, name, playerId } = req.body;

  if (!date || !court || !slot) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const bookings = store.loadBookings();
  const existing = bookings[date]?.[court]?.[slot];

  if (!existing) {
    return res.status(404).json({ error: 'Booking not found' });
  }

  // Check if requester matches booking owner
  let canCancel = false;
  if (playerId && existing.playerId === playerId) {
    canCancel = true;
  } else if (name) {
    const bookerName = existing.bookedBy || existing.name;
    if (bookerName.toLowerCase() === name.trim().toLowerCase()) {
      canCancel = true;
    }
  }

  if (!canCancel) {
    return res.status(403).json({ error: 'Name does not match the booking' });
  }

  store.addLog({ event: 'booking_cancelled', playerName: existing.bookedBy || existing.name, court, slot, date });
  delete bookings[date][court][slot];
  store.saveBookings(bookings);

  io.emit('bookingCancel', { date, court, slot });
  io.emit('statsUpdate', { date, stats: computeStats(date) });
  res.json({ success: true });
});

// =====================
//  Match scoring
// =====================
app.get('/api/matches/:date', (req, res) => {
  const matches = store.loadMatches();
  res.json(matches[req.params.date] || {});
});

app.post('/api/matches', (req, res) => {
  const { date, court, slot, team1, team2, team1Sets, team2Sets, winner } = req.body;

  if (!date || !court || !slot || !team1 || !team2) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const matches = store.loadMatches();
  if (!matches[date]) matches[date] = {};
  const key = `${court}|${slot}`;

  matches[date][key] = {
    court,
    slot,
    team1,
    team2,
    team1Sets: team1Sets ?? 0,
    team2Sets: team2Sets ?? 0,
    winner: winner || null,
    submittedAt: new Date().toISOString()
  };

  store.saveMatches(matches);
  io.emit('matchUpdate', { date, court, slot, match: matches[date][key] });
  res.json({ success: true });
});

// Leaderboard
app.get('/api/leaderboard', (req, res) => {
  const matches = store.loadMatches();
  const stats = {};

  Object.values(matches).forEach(dateMatches => {
    Object.values(dateMatches).forEach(match => {
      if (!match.winner) return;
      const winners = match[match.winner] || [];
      const loserKey = match.winner === 'team1' ? 'team2' : 'team1';
      const losers = match[loserKey] || [];

      winners.forEach(name => {
        if (!stats[name]) stats[name] = { name, played: 0, wins: 0, losses: 0 };
        stats[name].played++;
        stats[name].wins++;
      });
      losers.forEach(name => {
        if (!stats[name]) stats[name] = { name, played: 0, wins: 0, losses: 0 };
        stats[name].played++;
        stats[name].losses++;
      });
    });
  });

  const leaderboard = Object.values(stats)
    .map(s => ({ ...s, winRate: s.played > 0 ? Math.round((s.wins / s.played) * 100) : 0 }))
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);

  res.json(leaderboard);
});

// =====================
//  Admin API routes
// =====================

// Admin: booking logs
app.get('/api/admin/logs', requireAdmin, (req, res) => {
  res.json(store.loadLogs());
});

// Verify admin PIN
app.post('/api/admin/auth', (req, res) => {
  const { pin } = req.body;
  const admin = store.loadAdmin();
  if (pin === admin.adminPin) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid PIN' });
  }
});

// Admin: manage players
app.post('/api/admin/players', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  const player = store.createPlayer(name.trim());
  if (!player) {
    return res.status(409).json({ error: 'Player already exists' });
  }
  io.emit('playerAdded', player);
  res.json(player);
});

app.put('/api/admin/players/:id', requireAdmin, (req, res) => {
  const data = store.loadPlayers();
  const player = data.players.find(p => p.id === req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  if (req.body.name) player.name = req.body.name.trim();
  if (req.body.active !== undefined) player.active = req.body.active;

  store.savePlayers(data);
  res.json(player);
});

app.delete('/api/admin/players/:id', requireAdmin, (req, res) => {
  const data = store.loadPlayers();
  const player = data.players.find(p => p.id === req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  player.active = false;
  store.savePlayers(data);
  res.json({ success: true });
});

// Admin: get all players (including inactive)
app.get('/api/admin/players', requireAdmin, (req, res) => {
  const { players } = store.loadPlayers();
  res.json(players);
});

// Admin: lock/unlock courts
app.post('/api/admin/lock', requireAdmin, (req, res) => {
  const { date, court, slots } = req.body;
  if (!date || !court) return res.status(400).json({ error: 'Date and court required' });

  const admin = store.loadAdmin();
  if (!admin.lockedSlots) admin.lockedSlots = {};
  if (!admin.lockedSlots[date]) admin.lockedSlots[date] = {};

  // If slots array is given, lock specific slots; otherwise lock entire court
  admin.lockedSlots[date][court] = slots || true;
  store.saveAdmin(admin);

  io.emit('locksUpdate', { date, lockedSlots: admin.lockedSlots });
  res.json({ success: true });
});

app.delete('/api/admin/lock', requireAdmin, (req, res) => {
  const { date, court } = req.body;
  if (!date || !court) return res.status(400).json({ error: 'Date and court required' });

  const admin = store.loadAdmin();
  if (admin.lockedSlots?.[date]) {
    delete admin.lockedSlots[date][court];
    if (Object.keys(admin.lockedSlots[date]).length === 0) {
      delete admin.lockedSlots[date];
    }
  }
  store.saveAdmin(admin);

  io.emit('locksUpdate', { date, lockedSlots: admin.lockedSlots || {} });
  res.json({ success: true });
});

// Admin: force cancel booking
app.delete('/api/admin/book', requireAdmin, (req, res) => {
  const { date, court, slot } = req.body;
  if (!date || !court || !slot) return res.status(400).json({ error: 'Missing fields' });

  const bookings = store.loadBookings();
  const existing = bookings[date]?.[court]?.[slot];
  if (!existing) {
    return res.status(404).json({ error: 'Booking not found' });
  }

  store.addLog({ event: 'booking_cancelled', playerName: existing.bookedBy || existing.name, court, slot, date, byAdmin: true });
  delete bookings[date][court][slot];
  store.saveBookings(bookings);

  io.emit('bookingCancel', { date, court, slot });
  io.emit('statsUpdate', { date, stats: computeStats(date) });
  res.json({ success: true });
});

// Admin: force book
app.post('/api/admin/book', requireAdmin, (req, res) => {
  const { date, court, slot, playerName, players: playerList } = req.body;
  if (!date || !court || !slot || !playerName) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const bookings = store.loadBookings();
  if (!bookings[date]) bookings[date] = {};
  if (!bookings[date][court]) bookings[date][court] = {};

  const booking = {
    name: playerName,
    bookedBy: playerName,
    players: playerList || [playerName],
    bookedAt: new Date().toISOString(),
    adminBooked: true
  };

  bookings[date][court][slot] = booking;
  store.saveBookings(bookings);

  io.emit('bookingUpdate', { date, court, slot, booking });
  io.emit('statsUpdate', { date, stats: computeStats(date) });
  res.json({ success: true });
});

// Admin: update match scores
app.put('/api/admin/matches', requireAdmin, (req, res) => {
  const { date, court, slot, team1, team2, team1Sets, team2Sets, winner } = req.body;
  if (!date || !court || !slot) return res.status(400).json({ error: 'Missing fields' });

  const matches = store.loadMatches();
  if (!matches[date]) matches[date] = {};
  const key = `${court}|${slot}`;

  matches[date][key] = {
    court, slot, team1, team2,
    team1Sets: team1Sets ?? 0,
    team2Sets: team2Sets ?? 0,
    winner: winner || null,
    submittedAt: new Date().toISOString(),
    adminEdited: true
  };

  store.saveMatches(matches);
  io.emit('matchUpdate', { date, court, slot, match: matches[date][key] });
  res.json({ success: true });
});

// Admin: update settings
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const admin = store.loadAdmin();
  if (req.body.settings) {
    admin.settings = { ...admin.settings, ...req.body.settings };
  }
  if (req.body.adminPin) {
    admin.adminPin = req.body.adminPin;
  }
  if (req.body.courts) {
    admin.courts = req.body.courts;
  }
  store.saveAdmin(admin);
  res.json({ success: true });
});

// Admin: get settings
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const admin = store.loadAdmin();
  res.json({
    settings: admin.settings,
    courts: admin.courts,
    lockedSlots: admin.lockedSlots || {}
  });
});

// =====================
//  Socket.io
// =====================
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// =====================
//  Start server
// =====================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎾 Kabreet Padel Booking App running!`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://<your-ip>:${PORT}\n`);
});
