const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const MATCHES_FILE = path.join(DATA_DIR, 'matches.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Simple in-memory write queue to prevent race conditions
let writeQueue = Promise.resolve();

function queueWrite(filePath, data) {
  writeQueue = writeQueue.then(() => {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }).catch(() => {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  });
}

function loadJSON(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) return defaultValue;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultValue;
  }
}

// =====================
//  Migration: move old bookings.json from root into data/
// =====================
function migrateIfNeeded() {
  const oldFile = path.join(__dirname, 'bookings.json');
  if (fs.existsSync(oldFile) && !fs.existsSync(BOOKINGS_FILE)) {
    try {
      const data = fs.readFileSync(oldFile, 'utf8');
      fs.writeFileSync(BOOKINGS_FILE, data);
      console.log('Migrated bookings.json into data/ directory');
    } catch {
      console.warn('Could not migrate old bookings.json');
    }
  }
}

migrateIfNeeded();

// =====================
//  Players
// =====================
const DEFAULT_PLAYERS = { players: [], nextId: 1 };

function loadPlayers() {
  return loadJSON(PLAYERS_FILE, DEFAULT_PLAYERS);
}

function savePlayers(data) {
  queueWrite(PLAYERS_FILE, data);
}

function getPlayerById(id) {
  const { players } = loadPlayers();
  return players.find(p => p.id === id);
}

function getPlayerByName(name) {
  const { players } = loadPlayers();
  return players.find(p => p.name.toLowerCase() === name.toLowerCase() && p.active);
}

function createPlayer(name) {
  const data = loadPlayers();
  const existing = data.players.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    if (!existing.active) {
      existing.active = true;
      savePlayers(data);
      return existing;
    }
    return null; // already exists
  }
  const player = {
    id: `p_${data.nextId++}`,
    name: name.trim(),
    createdAt: new Date().toISOString(),
    active: true
  };
  data.players.push(player);
  savePlayers(data);
  return player;
}

// =====================
//  Bookings
// =====================
function loadBookings() {
  return loadJSON(BOOKINGS_FILE, {});
}

function saveBookings(data) {
  queueWrite(BOOKINGS_FILE, data);
}

// =====================
//  Admin config
// =====================
const DEFAULT_ADMIN = {
  adminPin: '1234',
  courts: ['Court 1', 'Court 2'],
  lockedSlots: {},
  settings: {
    maxBookingsPerPlayerPerDay: 3,
    bookingWindowDays: 7,
    minCancelHours: 0
  }
};

function loadAdmin() {
  return loadJSON(ADMIN_FILE, DEFAULT_ADMIN);
}

function saveAdmin(data) {
  queueWrite(ADMIN_FILE, data);
}

function isSlotLocked(date, court, slot) {
  const admin = loadAdmin();
  const locks = admin.lockedSlots || {};
  if (locks[date]?.[court] === true) return true; // whole court locked
  if (Array.isArray(locks[date]?.[court]) && locks[date][court].includes(slot)) return true;
  return false;
}

// =====================
//  Matches
// =====================
function loadMatches() {
  return loadJSON(MATCHES_FILE, {});
}

function saveMatches(data) {
  queueWrite(MATCHES_FILE, data);
}

// =====================
//  Init default files if they don't exist
// =====================
if (!fs.existsSync(PLAYERS_FILE)) savePlayers(DEFAULT_PLAYERS);
if (!fs.existsSync(ADMIN_FILE)) saveAdmin(DEFAULT_ADMIN);
if (!fs.existsSync(MATCHES_FILE)) saveMatches({});

module.exports = {
  loadPlayers,
  savePlayers,
  getPlayerById,
  getPlayerByName,
  createPlayer,
  loadBookings,
  saveBookings,
  loadAdmin,
  saveAdmin,
  isSlotLocked,
  loadMatches,
  saveMatches
};
