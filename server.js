// ═══════════════════════════════════════════════════════════════════
// EVOLIA SERVER — Serveur multijoueur Node.js
// Partage de progression, classement, amis
// ═══════════════════════════════════════════════════════════════════
// Installation: npm install express cors
// Lancement: node server.js
// ═══════════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'evolia_db.json');

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ─── Simple JSON database ──────────────────────────────────────────
function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {}
  return { players: {}, messages: [] };
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ─── AUTH MIDDLEWARE ───────────────────────────────────────────────
function requireAuth(req, res, next) {
  const { username, code } = req.headers;
  if (!username || !code) return res.status(401).json({ error: 'Non authentifié' });
  const db = loadDB();
  const player = db.players[username.toLowerCase()];
  if (!player || player.code !== code.toUpperCase()) {
    return res.status(403).json({ error: 'Identifiants incorrects' });
  }
  req.player = player;
  req.playerKey = username.toLowerCase();
  req.db = db;
  next();
}

// ═══════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', name: 'Evolia Server' });
});

// ─── REGISTER ─────────────────────────────────────────────────────
app.post('/register', (req, res) => {
  const { username, code } = req.body;
  if (!username || !code) return res.status(400).json({ error: 'Données manquantes' });
  if (username.length < 2 || username.length > 20) return res.status(400).json({ error: 'Pseudo invalide (2-20 caractères)' });

  const db = loadDB();
  const key = username.toLowerCase().trim();

  if (db.players[key]) return res.status(409).json({ error: 'Pseudo déjà utilisé' });

  db.players[key] = {
    username,
    code: code.toUpperCase(),
    xp: 0, coins: 0, diamonds: 0, level: 1,
    streak: 0, trophies: [], owned: [], equipped: {},
    botColor: '#7c5cbf', responses: {}, bpClaimed: [],
    avatar: '', avatarType: 'emoji',
    friends: [],
    createdAt: Date.now(),
    lastSeen: Date.now(),
  };
  saveDB(db);
  res.json({ success: true, message: 'Compte créé !' });
});

// ─── SYNC (push local data to server) ─────────────────────────────
app.post('/sync', requireAuth, (req, res) => {
  const { xp, coins, diamonds, streak, trophies, owned, equipped, botColor, responses, bpClaimed, avatar, avatarType, level } = req.body;
  const db = req.db;
  const p = db.players[req.playerKey];

  // Only sync upwards (never lose data)
  if (xp !== undefined) p.xp = Math.max(p.xp || 0, xp);
  if (coins !== undefined) p.coins = Math.max(p.coins || 0, coins);
  if (diamonds !== undefined) p.diamonds = Math.max(p.diamonds || 0, diamonds);
  if (streak !== undefined) p.streak = streak;
  if (trophies) p.trophies = [...new Set([...(p.trophies || []), ...trophies])];
  if (owned) p.owned = [...new Set([...(p.owned || []), ...owned])];
  if (equipped) p.equipped = equipped;
  if (botColor) p.botColor = botColor;
  if (responses && typeof responses === 'object') {
    p.responses = { ...(p.responses || {}), ...responses };
  }
  if (bpClaimed) p.bpClaimed = [...new Set([...(p.bpClaimed || []), ...bpClaimed])];
  if (avatar) { p.avatar = avatar; p.avatarType = avatarType || 'emoji'; }
  if (level) p.level = Math.max(p.level || 1, level);
  p.lastSeen = Date.now();

  saveDB(db);
  res.json({ success: true, player: sanitize(p) });
});

// ─── PULL (get server data) ────────────────────────────────────────
app.get('/pull', requireAuth, (req, res) => {
  const p = req.db.players[req.playerKey];
  p.lastSeen = Date.now();
  saveDB(req.db);
  res.json({ success: true, player: sanitize(p) });
});

// ─── LEADERBOARD ──────────────────────────────────────────────────
app.get('/leaderboard', (req, res) => {
  const db = loadDB();
  const top = Object.values(db.players)
    .map(p => ({
      username: p.username,
      xp: p.xp || 0,
      level: p.level || 1,
      coins: p.coins || 0,
      diamonds: p.diamonds || 0,
      streak: p.streak || 0,
      trophies: (p.trophies || []).length,
      avatar: p.avatar || '',
      avatarType: p.avatarType || 'emoji',
      botColor: p.botColor || '#7c5cbf',
      lastSeen: p.lastSeen || 0,
    }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 50);
  res.json({ success: true, leaderboard: top });
});

// ─── PLAYER PROFILE ───────────────────────────────────────────────
app.get('/player/:username', (req, res) => {
  const db = loadDB();
  const p = db.players[req.params.username.toLowerCase()];
  if (!p) return res.status(404).json({ error: 'Joueur introuvable' });
  res.json({ success: true, player: sanitize(p) });
});

// ─── FRIENDS ──────────────────────────────────────────────────────
app.post('/friend/add', requireAuth, (req, res) => {
  const { friendName } = req.body;
  if (!friendName) return res.status(400).json({ error: 'Nom manquant' });
  const db = req.db;
  const fKey = friendName.toLowerCase();
  if (!db.players[fKey]) return res.status(404).json({ error: 'Joueur introuvable' });
  if (fKey === req.playerKey) return res.status(400).json({ error: 'Vous ne pouvez pas vous ajouter vous-même' });

  const p = db.players[req.playerKey];
  if (!p.friends) p.friends = [];
  if (p.friends.includes(fKey)) return res.status(409).json({ error: 'Déjà ami' });
  p.friends.push(fKey);
  saveDB(db);
  res.json({ success: true, message: `${db.players[fKey].username} ajouté !` });
});

app.get('/friends', requireAuth, (req, res) => {
  const db = req.db;
  const p = db.players[req.playerKey];
  const friends = (p.friends || []).map(fKey => {
    const f = db.players[fKey];
    if (!f) return null;
    return {
      username: f.username, xp: f.xp || 0, level: f.level || 1,
      avatar: f.avatar || '', avatarType: f.avatarType || 'emoji',
      botColor: f.botColor || '#7c5cbf', lastSeen: f.lastSeen || 0,
      online: (Date.now() - (f.lastSeen || 0)) < 5 * 60 * 1000,
    };
  }).filter(Boolean);
  res.json({ success: true, friends });
});

// ─── GLOBAL CHAT ──────────────────────────────────────────────────
app.get('/chat', (req, res) => {
  const db = loadDB();
  res.json({ success: true, messages: (db.messages || []).slice(-50) });
});

app.post('/chat', requireAuth, (req, res) => {
  const { message } = req.body;
  if (!message || message.length > 200) return res.status(400).json({ error: 'Message invalide' });
  const db = req.db;
  if (!db.messages) db.messages = [];
  const p = db.players[req.playerKey];
  db.messages.push({
    username: p.username, message,
    avatar: p.avatar || '', avatarType: p.avatarType || 'emoji',
    ts: Date.now(),
  });
  // Keep last 200 messages
  if (db.messages.length > 200) db.messages = db.messages.slice(-200);
  saveDB(db);
  res.json({ success: true });
});

// ─── HELPERS ──────────────────────────────────────────────────────
function sanitize(p) {
  const { code, ...safe } = p;
  return safe;
}

// ─── START ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🤖 Evolia Server running on http://localhost:${PORT}`);
  console.log(`📊 Leaderboard: http://localhost:${PORT}/leaderboard`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /register       — Créer un compte`);
  console.log(`  POST /sync           — Sauvegarder progression`);
  console.log(`  GET  /pull           — Récupérer progression`);
  console.log(`  GET  /leaderboard    — Classement top 50`);
  console.log(`  GET  /player/:name   — Profil public`);
  console.log(`  POST /friend/add     — Ajouter ami`);
  console.log(`  GET  /friends        — Liste amis`);
  console.log(`  GET  /chat           — Lire le chat global`);
  console.log(`  POST /chat           — Envoyer message\n`);
});
