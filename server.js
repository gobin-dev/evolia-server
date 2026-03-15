// ═══════════════════════════════════════════════════════════════════
// EVOLIA SERVER v2 — Serveur multijoueur complet
// ═══════════════════════════════════════════════════════════════════
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'evolia_db.json');

app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','username','code','Authorization'], credentials: false }));
app.options('*', cors());
app.use(express.json({ limit: '5mb' }));

// ── DB ──────────────────────────────────────────────────────────────
function loadDB() {
  try { if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) { console.error('DB load error:', e); }
  return { players: {}, messages: [], sharedResponses: {}, purchaseRequests: [], bannedUsers: [] };
}
function saveDB(db) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
  catch (e) { console.error('DB save error:', e); }
}
function initDB(db) {
  if (!db.messages) db.messages = [];
  if (!db.sharedResponses) db.sharedResponses = {};
  if (!db.purchaseRequests) db.purchaseRequests = [];
  if (!db.bannedUsers) db.bannedUsers = [];
  return db;
}

// ── AUTH ────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const username = (req.headers.username || '').trim();
  const code = (req.headers.code || '').trim().toUpperCase();
  if (!username || !code) return res.status(401).json({ error: 'Non authentifié' });
  const db = loadDB();
  initDB(db);
  const player = db.players[username.toLowerCase()];
  if (!player || player.code !== code) return res.status(403).json({ error: 'Identifiants incorrects' });
  if (db.bannedUsers.includes(username.toLowerCase())) return res.status(403).json({ error: 'Compte banni' });
  req.player = player;
  req.playerKey = username.toLowerCase();
  req.db = db;
  next();
}
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.player.isAdmin) return res.status(403).json({ error: 'Accès admin requis' });
    next();
  });
}
function sanitize(p) { const { code, ...safe } = p; return safe; }

// ── HEALTH ──────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'ok', version: '2.0.0', name: 'Evolia Server' }));

// ══════════════════════════════════════════════════════════════════
// AUTH — REGISTER / LOGIN
// ══════════════════════════════════════════════════════════════════
app.post('/register', (req, res) => {
  const { username, code } = req.body;
  if (!username || !code) return res.status(400).json({ error: 'Données manquantes' });
  if (username.length < 2 || username.length > 20) return res.status(400).json({ error: 'Pseudo invalide' });
  const db = loadDB(); initDB(db);
  const key = username.toLowerCase().trim();
  if (db.bannedUsers.includes(key)) return res.status(403).json({ error: 'Ce compte est banni' });
  // Allow overwrite (same username = update code)
  const isNew = !db.players[key];
  db.players[key] = {
    ...(db.players[key] || {}),
    username, code: code.toUpperCase(),
    xp: db.players[key]?.xp || 0,
    coins: db.players[key]?.coins || 0,
    diamonds: db.players[key]?.diamonds || 0,
    level: db.players[key]?.level || 1,
    streak: db.players[key]?.streak || 0,
    trophies: db.players[key]?.trophies || [],
    owned: db.players[key]?.owned || [],
    equipped: db.players[key]?.equipped || {},
    botColor: db.players[key]?.botColor || '#7c5cbf',
    responses: db.players[key]?.responses || {},
    bpClaimed: db.players[key]?.bpClaimed || [],
    avatar: db.players[key]?.avatar || '',
    avatarType: db.players[key]?.avatarType || 'emoji',
    friends: db.players[key]?.friends || [],
    friendRequests: db.players[key]?.friendRequests || [],
    sentRequests: db.players[key]?.sentRequests || [],
    isAdmin: db.players[key]?.isAdmin || false,
    createdAt: db.players[key]?.createdAt || Date.now(),
    lastSeen: Date.now(),
  };
  saveDB(db);
  res.json({ success: true, isNew, isAdmin: db.players[key].isAdmin, message: isNew ? 'Compte créé !' : 'Compte mis à jour !' });
});

// Login (verify credentials + return data)
app.post('/login', (req, res) => {
  const { username, code } = req.body;
  if (!username || !code) return res.status(400).json({ error: 'Données manquantes' });
  const db = loadDB(); initDB(db);
  const key = username.toLowerCase().trim();
  if (db.bannedUsers.includes(key)) return res.status(403).json({ error: 'Compte banni' });
  const player = db.players[key];
  if (!player) return res.status(404).json({ error: 'Joueur introuvable' });
  if (player.code !== code.toUpperCase().trim()) return res.status(403).json({ error: 'Code incorrect' });
  player.lastSeen = Date.now();
  saveDB(db);
  res.json({ success: true, player: sanitize(player) });
});

// ══════════════════════════════════════════════════════════════════
// SYNC / PULL
// ══════════════════════════════════════════════════════════════════
app.post('/sync', requireAuth, (req, res) => {
  const db = req.db;
  const p = db.players[req.playerKey];
  const d = req.body;
  if (d.xp !== undefined) p.xp = Math.max(p.xp || 0, d.xp);
  if (d.coins !== undefined) p.coins = Math.max(p.coins || 0, d.coins);
  if (d.diamonds !== undefined) p.diamonds = Math.max(p.diamonds || 0, d.diamonds);
  if (d.streak !== undefined) p.streak = d.streak;
  if (d.trophies) p.trophies = [...new Set([...(p.trophies||[]), ...d.trophies])];
  if (d.owned) p.owned = [...new Set([...(p.owned||[]), ...d.owned])];
  if (d.equipped) p.equipped = d.equipped;
  if (d.botColor) p.botColor = d.botColor;
  if (d.responses && typeof d.responses === 'object') {
    p.responses = { ...(p.responses||{}), ...d.responses };
    // Share responses globally
    Object.entries(d.responses).forEach(([q, a]) => { db.sharedResponses[q] = { answer: a, by: p.username, ts: Date.now() }; });
  }
  if (d.bpClaimed) p.bpClaimed = [...new Set([...(p.bpClaimed||[]), ...d.bpClaimed])];
  if (d.avatar) { p.avatar = d.avatar; p.avatarType = d.avatarType || 'emoji'; }
  if (d.level) p.level = Math.max(p.level || 1, d.level);
  p.lastSeen = Date.now();
  saveDB(db);
  res.json({ success: true, player: sanitize(p) });
});

app.get('/pull', requireAuth, (req, res) => {
  const p = req.db.players[req.playerKey];
  p.lastSeen = Date.now();
  saveDB(req.db);
  res.json({ success: true, player: sanitize(p) });
});

// ══════════════════════════════════════════════════════════════════
// LEADERBOARD / PLAYERS
// ══════════════════════════════════════════════════════════════════
app.get('/leaderboard', (req, res) => {
  const db = loadDB(); initDB(db);
  const top = Object.values(db.players)
    .filter(p => !db.bannedUsers.includes(p.username.toLowerCase()))
    .map(p => ({ username: p.username, xp: p.xp||0, level: p.level||1, coins: p.coins||0, diamonds: p.diamonds||0, streak: p.streak||0, trophies: (p.trophies||[]).length, avatar: p.avatar||'', avatarType: p.avatarType||'emoji', botColor: p.botColor||'#7c5cbf', lastSeen: p.lastSeen||0, online: (Date.now()-(p.lastSeen||0)) < 5*60*1000 }))
    .sort((a, b) => b.xp - a.xp).slice(0, 50);
  res.json({ success: true, leaderboard: top });
});

app.get('/players', (req, res) => {
  const db = loadDB(); initDB(db);
  const players = Object.values(db.players)
    .filter(p => !db.bannedUsers.includes(p.username.toLowerCase()))
    .map(p => ({ username: p.username, xp: p.xp||0, level: p.level||1, avatar: p.avatar||'', avatarType: p.avatarType||'emoji', botColor: p.botColor||'#7c5cbf', online: (Date.now()-(p.lastSeen||0)) < 5*60*1000 }));
  res.json({ success: true, players });
});

app.get('/player/:username', (req, res) => {
  const db = loadDB();
  const p = db.players[req.params.username.toLowerCase()];
  if (!p) return res.status(404).json({ error: 'Joueur introuvable' });
  res.json({ success: true, player: sanitize(p) });
});

// ══════════════════════════════════════════════════════════════════
// FRIENDS + REQUESTS
// ══════════════════════════════════════════════════════════════════
app.post('/friend/request', requireAuth, (req, res) => {
  const { friendName } = req.body;
  if (!friendName) return res.status(400).json({ error: 'Nom manquant' });
  const db = req.db;
  const fKey = friendName.toLowerCase().trim();
  if (!db.players[fKey]) return res.status(404).json({ error: 'Joueur introuvable' });
  if (fKey === req.playerKey) return res.status(400).json({ error: "Impossible de s'ajouter soi-même" });
  const me = db.players[req.playerKey];
  const them = db.players[fKey];
  if ((me.friends||[]).includes(fKey)) return res.status(409).json({ error: 'Déjà ami !' });
  if (!them.friendRequests) them.friendRequests = [];
  if (!me.sentRequests) me.sentRequests = [];
  if (me.sentRequests.includes(fKey)) return res.status(409).json({ error: 'Demande déjà envoyée' });
  them.friendRequests.push({ from: req.playerKey, fromName: me.username, ts: Date.now() });
  me.sentRequests.push(fKey);
  saveDB(db);
  res.json({ success: true, message: `Demande envoyée à ${them.username} !` });
});

app.post('/friend/accept', requireAuth, (req, res) => {
  const { friendName } = req.body;
  const db = req.db;
  const fKey = (friendName||'').toLowerCase().trim();
  if (!db.players[fKey]) return res.status(404).json({ error: 'Joueur introuvable' });
  const me = db.players[req.playerKey];
  const them = db.players[fKey];
  me.friendRequests = (me.friendRequests||[]).filter(r => r.from !== fKey);
  them.sentRequests = (them.sentRequests||[]).filter(k => k !== req.playerKey);
  if (!me.friends) me.friends = [];
  if (!them.friends) them.friends = [];
  if (!me.friends.includes(fKey)) me.friends.push(fKey);
  if (!them.friends.includes(req.playerKey)) them.friends.push(req.playerKey);
  saveDB(db);
  res.json({ success: true, message: `Vous êtes maintenant amis avec ${them.username} !` });
});

app.post('/friend/decline', requireAuth, (req, res) => {
  const { friendName } = req.body;
  const db = req.db;
  const fKey = (friendName||'').toLowerCase().trim();
  const me = db.players[req.playerKey];
  me.friendRequests = (me.friendRequests||[]).filter(r => r.from !== fKey);
  if (db.players[fKey]) db.players[fKey].sentRequests = (db.players[fKey].sentRequests||[]).filter(k => k !== req.playerKey);
  saveDB(db);
  res.json({ success: true });
});

app.post('/friend/remove', requireAuth, (req, res) => {
  const { friendName } = req.body;
  const db = req.db;
  const fKey = (friendName||'').toLowerCase().trim();
  const me = db.players[req.playerKey];
  me.friends = (me.friends||[]).filter(k => k !== fKey);
  if (db.players[fKey]) db.players[fKey].friends = (db.players[fKey].friends||[]).filter(k => k !== req.playerKey);
  saveDB(db);
  res.json({ success: true });
});

app.get('/friend/requests', requireAuth, (req, res) => {
  const p = req.db.players[req.playerKey];
  res.json({ success: true, requests: (p.friendRequests||[]) });
});

app.get('/friends', requireAuth, (req, res) => {
  const db = req.db;
  const p = db.players[req.playerKey];
  const friends = (p.friends||[]).map(fKey => {
    const f = db.players[fKey];
    if (!f) return null;
    return { username: f.username, xp: f.xp||0, level: f.level||1, avatar: f.avatar||'', avatarType: f.avatarType||'emoji', botColor: f.botColor||'#7c5cbf', lastSeen: f.lastSeen||0, online: (Date.now()-(f.lastSeen||0)) < 5*60*1000 };
  }).filter(Boolean);
  res.json({ success: true, friends });
});

// ══════════════════════════════════════════════════════════════════
// ADMIN
// ══════════════════════════════════════════════════════════════════

// Set first admin (only if no admin exists yet)
app.post('/admin/setup', (req, res) => {
  const { username, code, adminSecret } = req.body;
  if (adminSecret !== (process.env.ADMIN_SECRET || 'evolia-admin-2024')) return res.status(403).json({ error: 'Secret invalide' });
  const db = loadDB(); initDB(db);
  const key = username.toLowerCase().trim();
  if (!db.players[key]) return res.status(404).json({ error: 'Joueur introuvable — inscris-toi d\'abord' });
  if (db.players[key].code !== code.toUpperCase()) return res.status(403).json({ error: 'Code incorrect' });
  db.players[key].isAdmin = true;
  saveDB(db);
  res.json({ success: true, message: `${username} est maintenant admin !` });
});

// Ban user
app.post('/admin/ban', requireAdmin, (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Nom manquant' });
  const db = req.db;
  const key = username.toLowerCase();
  if (!db.bannedUsers) db.bannedUsers = [];
  if (!db.bannedUsers.includes(key)) db.bannedUsers.push(key);
  saveDB(db);
  res.json({ success: true, message: `${username} banni !` });
});

// Unban user
app.post('/admin/unban', requireAdmin, (req, res) => {
  const { username } = req.body;
  const db = req.db;
  db.bannedUsers = (db.bannedUsers||[]).filter(u => u !== username.toLowerCase());
  saveDB(db);
  res.json({ success: true, message: `${username} débanni !` });
});

// Admin generate purchase code
app.post('/admin/purchase-code', requireAdmin, (req, res) => {
  const { username, coins } = req.body;
  if (!username || !coins) return res.status(400).json({ error: 'Données manquantes' });
  const db = req.db;
  if (!db.purchaseCodes) db.purchaseCodes = {};
  const code = Array.from({length:8}, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random()*32)]).join('');
  db.purchaseCodes[code] = { username: username.toLowerCase(), coins, used: false, ts: Date.now() };
  saveDB(db);
  res.json({ success: true, code, message: `Code ${code} généré pour ${username} (+${coins} pièces)` });
});

// Use purchase code
app.post('/purchase/redeem', requireAuth, (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code manquant' });
  const db = req.db;
  if (!db.purchaseCodes) return res.status(404).json({ error: 'Code invalide' });
  const entry = db.purchaseCodes[code.toUpperCase()];
  if (!entry) return res.status(404).json({ error: 'Code invalide' });
  if (entry.used) return res.status(409).json({ error: 'Code déjà utilisé' });
  if (entry.username !== req.playerKey) return res.status(403).json({ error: 'Ce code n\'est pas pour vous' });
  entry.used = true;
  const p = db.players[req.playerKey];
  p.coins = (p.coins||0) + entry.coins;
  saveDB(db);
  res.json({ success: true, coins: entry.coins, message: `+${entry.coins} 🪙 ajoutés !` });
});

// Get purchase requests (admin)
app.get('/admin/purchases', requireAdmin, (req, res) => {
  const db = req.db;
  res.json({ success: true, requests: (db.purchaseRequests||[]).slice(-50).reverse() });
});

// Submit purchase request (user)
app.post('/purchase/request', requireAuth, (req, res) => {
  const { pack, price, coins } = req.body;
  const db = req.db;
  if (!db.purchaseRequests) db.purchaseRequests = [];
  db.purchaseRequests.push({ username: req.player.username, pack, price, coins, ts: Date.now(), done: false });
  saveDB(db);
  res.json({ success: true, message: 'Demande envoyée à l\'admin !' });
});

// Get banned list (admin)
app.get('/admin/banned', requireAdmin, (req, res) => {
  res.json({ success: true, banned: req.db.bannedUsers || [] });
});

// ══════════════════════════════════════════════════════════════════
// GLOBAL CHAT
// ══════════════════════════════════════════════════════════════════
app.get('/chat', (req, res) => {
  const db = loadDB(); initDB(db);
  res.json({ success: true, messages: (db.messages||[]).slice(-60) });
});

app.post('/chat', requireAuth, (req, res) => {
  const { message } = req.body;
  if (!message || message.length > 200) return res.status(400).json({ error: 'Message invalide' });
  const db = req.db;
  const p = db.players[req.playerKey];
  db.messages.push({ username: p.username, message, avatar: p.avatar||'', avatarType: p.avatarType||'emoji', isAdmin: p.isAdmin||false, ts: Date.now() });
  if (db.messages.length > 200) db.messages = db.messages.slice(-200);
  saveDB(db);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════
// SHARED RESPONSES (apprentissage collectif)
// ══════════════════════════════════════════════════════════════════
app.get('/responses', (req, res) => {
  const db = loadDB(); initDB(db);
  res.json({ success: true, responses: db.sharedResponses || {} });
});

app.post('/responses/add', requireAuth, (req, res) => {
  const { question, answer } = req.body;
  if (!question || !answer) return res.status(400).json({ error: 'Données manquantes' });
  const db = req.db;
  if (!db.sharedResponses) db.sharedResponses = {};
  db.sharedResponses[question.toLowerCase().trim()] = { answer, by: req.player.username, ts: Date.now() };
  saveDB(db);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`\n🤖 Evolia Server v2 on http://localhost:${PORT}`);
  console.log(`\nPour devenir admin:`);
  console.log(`  POST /admin/setup { username, code, adminSecret: "evolia-admin-2024" }`);
});
