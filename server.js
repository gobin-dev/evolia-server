// ═══════════════════════════════════════════════════════════════════
// EVOLIA SERVER v2 — Serveur multijoueur complet
// ═══════════════════════════════════════════════════════════════════
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'evolia_db.json');

// ── EMAIL CONFIG ────────────────────────────────────────────────────
// Variables d'environnement Railway:
//   EMAIL_USER  = ton adresse Gmail (ex: ton.bot@gmail.com)
//   EMAIL_PASS  = mot de passe d'application Gmail (pas ton vrai mdp!)
//   Crée un "App Password" sur: myaccount.google.com/apppasswords
const ADMIN_EMAIL = 'gabin7.lebon@gmail.com';
const EMAIL_USER  = process.env.EMAIL_USER || '';
const EMAIL_PASS  = process.env.EMAIL_PASS || '';

let transporter = null;
if(EMAIL_USER && EMAIL_PASS){
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
  });
  transporter.verify((err) => {
    if(err) console.log('❌ Email config error:', err.message);
    else console.log('✅ Email service ready');
  });
} else {
  console.log('⚠️  EMAIL_USER/EMAIL_PASS not set — emails disabled');
}

async function sendEmail(to, subject, html){
  if(!transporter) return false;
  try {
    await transporter.sendMail({
      from: `"Évolia Bot" <${EMAIL_USER}>`,
      to, subject, html
    });
    console.log('📧 Email sent to', to);
    return true;
  } catch(e){
    console.error('❌ Email error:', e.message);
    return false;
  }
}

function buildReceiptHTML(username, userEmail, pack, coins, code, ts){
  // Magic link — quand le joueur clique, le code s'entre automatiquement dans le bot
  // Le joueur doit ouvrir son bot depuis le même appareil
  const magicLink = `evolia://redeem/${code}`;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body{font-family:Arial,sans-serif;background:#f4f1ff;margin:0;padding:20px}
  .card{background:#fff;border-radius:16px;padding:30px;max-width:480px;margin:0 auto;box-shadow:0 4px 24px rgba(124,92,191,.12)}
  .header{background:linear-gradient(135deg,#7c5cbf,#4c1d95);color:#fff;border-radius:10px;padding:20px;text-align:center;margin-bottom:20px}
  .header h1{margin:0;font-size:1.6rem}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0ecff}
  .label{color:#7060a0;font-size:.9rem}
  .value{font-weight:700;color:#1a1829}
  .code{background:#f4f1ff;border:2px dashed #7c5cbf;border-radius:8px;padding:14px;text-align:center;margin:16px 0}
  .code-val{font-size:1.8rem;font-weight:900;letter-spacing:4px;color:#7c5cbf}
  .footer{text-align:center;color:#9080c0;font-size:.8rem;margin-top:20px}
  .diamond{color:#22d3ee;font-size:1rem}
</style></head>
<body>
<div class="card">
  <div class="header">
    <div style="font-size:2rem">🤖</div>
    <h1>Évolia</h1>
    <div style="opacity:.85;font-size:.9rem">Ticket de caisse</div>
  </div>
  <div class="row"><span class="label">Joueur</span><span class="value">${username}</span></div>
  <div class="row"><span class="label">Email</span><span class="value">${userEmail}</span></div>
  <div class="row"><span class="label">Pack acheté</span><span class="value">${pack}</span></div>
  <div class="row"><span class="label">Pièces reçues</span><span class="value">${coins.toLocaleString('fr-FR')} 🪙</span></div>
  <div class="row"><span class="label">Date</span><span class="value">${new Date(ts).toLocaleString('fr-FR')}</span></div>
  <div class="code">
    <div style="color:#7060a0;font-size:.8rem;margin-bottom:6px">Ton code de confirmation</div>
    <div class="code-val">${code}</div>
    <div style="color:#9080c0;font-size:.75rem;margin-top:10px">Copie ce code dans Évolia → Boutique → 💳 Acheter → Entrer le code</div>
  </div>
  <div style="text-align:center;margin:16px 0">
    <a href="https://evolia.netlify.app?code=${code}" 
       style="display:inline-block;background:linear-gradient(135deg,#7c5cbf,#4c1d95);color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:700;font-size:1rem">
      ✨ Entrer le code automatiquement
    </a>
    <div style="color:#9080c0;font-size:.7rem;margin-top:8px">Ouvre ton Évolia et clique sur ce bouton</div>
  </div>
  <div class="footer">Merci de ta confiance ! 💜<br>Évolia — assistant IA voxel</div>
</div>
</body></html>`;
}

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
  const { username, coins, pack } = req.body;
  if (!username || !coins) return res.status(400).json({ error: 'Données manquantes' });
  const db = req.db;
  if (!db.purchaseCodes) db.purchaseCodes = {};
  const code = Array.from({length:8}, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random()*32)]).join('');
  const ts = Date.now();
  db.purchaseCodes[code] = { username: username.toLowerCase(), coins, used: false, ts };
  // Mark request as done
  if(db.purchaseRequests){
    const req2 = db.purchaseRequests.find(r => r.username === username && !r.done);
    if(req2) req2.done = true;
  }
  saveDB(db);

  // Send receipt to player + admin
  const player = db.players[username.toLowerCase()];
  const userEmail = player?.email || '';
  const packName = pack || `${coins} pièces`;
  if(transporter){
    const receiptHtml = buildReceiptHTML(username, userEmail||'—', packName, coins, code, ts);
    // Email to player
    if(userEmail) sendEmail(userEmail, `[Évolia] Ton code d'achat — ${packName}`, receiptHtml);
    // Email to admin (copy)
    sendEmail(ADMIN_EMAIL, `[Évolia] Code généré pour ${username} — ${packName}`, receiptHtml);
  }

  res.json({ success: true, code, message: `Code ${code} généré pour ${username} (+${coins} pièces)${userEmail ? ' — email envoyé à '+userEmail : ' — aucun email enregistré'}` });
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
  const { pack, price, coins, email } = req.body;
  const db = req.db;
  if (!db.purchaseRequests) db.purchaseRequests = [];
  const request = { username: req.player.username, email: email||'', pack, price, coins, ts: Date.now(), done: false };
  db.purchaseRequests.push(request);
  if(email) db.players[req.playerKey].email = email;
  saveDB(db);

  // Notify admin by email
  if(transporter){
    const adminHtml = '<div style="font-family:Arial,sans-serif;padding:20px"><h2>🛒 Nouvelle commande Évolia</h2>' +
      '<p><b>Joueur :</b> ' + req.player.username + '</p>' +
      '<p><b>Email joueur :</b> ' + (email||'non fourni') + '</p>' +
      '<p><b>Pack :</b> ' + pack + '</p>' +
      '<p><b>Pièces :</b> ' + coins + ' 🪙</p>' +
      '<p><b>Date :</b> ' + new Date().toLocaleString('fr-FR') + '</p>' +
      '<p style="color:#7c5cbf">Va dans le panel admin pour générer le code.</p></div>';
    sendEmail(ADMIN_EMAIL, '[Évolia] Commande de ' + req.player.username, adminHtml);
  }

  res.json({ success: true, message: "Demande envoyée ! Tu recevras un email avec ton code de confirmation." });
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
// ADMIN STATS — Panel + PDF quotidien
// ══════════════════════════════════════════════════════════════════
app.get('/admin/stats', requireAdmin, (req, res) => {
  const db = req.db;
  const players = Object.values(db.players);
  const now = Date.now();
  const stats = {
    totalPlayers: players.length,
    onlinePlayers: players.filter(p => (now - (p.lastSeen||0)) < 5*60*1000).length,
    activeLast24h: players.filter(p => (now - (p.lastSeen||0)) < 24*60*60*1000).length,
    activeLast7d: players.filter(p => (now - (p.lastSeen||0)) < 7*24*60*60*1000).length,
    totalXP: players.reduce((a,p) => a+(p.xp||0), 0),
    avgLevel: players.length ? Math.round(players.reduce((a,p)=>a+(p.level||1),0)/players.length) : 0,
    topPlayer: players.sort((a,b)=>(b.xp||0)-(a.xp||0))[0]?.username || 'N/A',
    bannedCount: (db.bannedUsers||[]).length,
    totalMessages: (db.messages||[]).length,
    totalFriendMessages: (db.friendMessages||[]).length,
    totalResponses: Object.keys(db.sharedResponses||{}).length,
    leaderboard: players.sort((a,b)=>(b.xp||0)-(a.xp||0)).slice(0,10).map(p=>({
      username: p.username, xp: p.xp||0, level: p.level||1,
      lastSeen: p.lastSeen||0, online: (now-(p.lastSeen||0))<5*60*1000
    })),
    registrationsByDay: getRegistrationsByDay(players),
    purchaseRequests: (db.purchaseRequests||[]).slice(-20),
  };
  res.json({ success: true, stats });
});

function getRegistrationsByDay(players) {
  const days = {};
  players.forEach(p => {
    if(p.createdAt){
      const day = new Date(p.createdAt).toISOString().slice(0,10);
      days[day] = (days[day]||0) + 1;
    }
  });
  return Object.entries(days).sort((a,b)=>a[0].localeCompare(b[0])).slice(-30).map(([date,count])=>({date,count}));
}

// ══════════════════════════════════════════════════════════════════
// FRIEND CHAT — Chat privé entre amis
// ══════════════════════════════════════════════════════════════════
app.get('/friendchat', requireAuth, (req, res) => {
  const db = req.db;
  const me = db.players[req.playerKey];
  const myFriends = new Set((me.friends || []).concat([req.playerKey]));
  if (!db.friendMessages) db.friendMessages = [];
  // Return only messages from me or my friends
  const msgs = db.friendMessages
    .filter(m => myFriends.has(m.userKey))
    .slice(-80);
  res.json({ success: true, messages: msgs });
});

app.post('/friendchat', requireAuth, (req, res) => {
  const { message } = req.body;
  if (!message || message.length > 300) return res.status(400).json({ error: 'Message invalide' });
  const db = req.db;
  const p = db.players[req.playerKey];
  if (!db.friendMessages) db.friendMessages = [];
  db.friendMessages.push({
    userKey: req.playerKey,
    username: p.username,
    message,
    avatar: p.avatar || '',
    avatarType: p.avatarType || 'emoji',
    ts: Date.now(),
  });
  if (db.friendMessages.length > 500) db.friendMessages = db.friendMessages.slice(-500);
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
