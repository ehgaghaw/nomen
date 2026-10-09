// Nomen — a naming layer for Solana tokens. Express server + registry API.
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default || require('bs58');
const store = require('./db');

const PORT = process.env.PORT || 3000;
const SUFFIX = 'mint';
const SITE_NAME = 'Nomen';
const PUBLIC_DIR = path.join(__dirname, 'public');
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '600kb' }));

// ---------- helpers ----------
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{1,22}[a-z0-9])$/;
const RESERVED = new Set([
  'mint', 'nomen', 'api', 'www', 'admin', 'root', 'sol', 'solana', 'ai', 'btc', 'eth', 'usdc', 'usdt',
  'pump', 'pumpfun', 'raydium', 'jupiter', 'phantom', 'solflare', 'name', 'names', 'resolve', 'resolver',
  'explore', 'launch', 'app', 'help', 'support', 'null', 'undefined', 'test', 'official', 'team',
]);
const now = () => new Date().toISOString();

function normalizeName(raw) {
  if (typeof raw !== 'string') return null;
  let n = raw.trim().toLowerCase();
  if (n.endsWith('.' + SUFFIX)) n = n.slice(0, -(SUFFIX.length + 1));
  if (n.startsWith('$')) n = n.slice(1);
  return n;
}

function checkName(label) {
  if (!label) return { ok: false, reason: 'Enter a name.' };
  if (label.length < 3) return { ok: false, reason: 'Names need at least 3 characters. Short names are reserved.' };
  if (label.length > 24) return { ok: false, reason: 'Names can be at most 24 characters.' };
  if (!NAME_RE.test(label)) return { ok: false, reason: 'Use lowercase letters, numbers or hyphens. No hyphen at either end.' };
  if (label.includes('--')) return { ok: false, reason: 'No double hyphens.' };
  if (RESERVED.has(label)) return { ok: false, reason: `${label}.${SUFFIX} is reserved.` };
  return { ok: true };
}

function isBase58Pubkey(s) {
  if (typeof s !== 'string' || s.length < 32 || s.length > 44) return false;
  try { return bs58.decode(s).length === 32; } catch { return false; }
}

function cleanUrl(v, hosts) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || v.length > 300) throw new Error('Link too long.');
  let s = v.trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { throw new Error(`Invalid link: ${v}`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Links must be http(s).');
  if (hosts && !hosts.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) {
    throw new Error(`That link should be on ${hosts.join(' or ')}.`);
  }
  return u.toString();
}

function cleanLinks(l = {}) {
  return {
    twitter: cleanUrl(l.twitter, ['x.com', 'twitter.com']),
    telegram: cleanUrl(l.telegram, ['t.me', 'telegram.me']),
    website: cleanUrl(l.website),
    pumpfun: cleanUrl(l.pumpfun, ['pump.fun']),
    community: cleanUrl(l.community),
  };
}

function cleanImage(img) {
  if (img == null || img === '') return null;
  if (typeof img !== 'string') throw new Error('Bad image.');
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(img)) throw new Error('Image must be PNG, JPG or WebP.');
  if (img.length > 400_000) throw new Error('Image too large. Use a square image under 2 MB.');
  return img;
}

function cleanText(v, max, label, required) {
  if (v == null) v = '';
  if (typeof v !== 'string') throw new Error(`${label} must be text.`);
  const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (required && !s) throw new Error(`${label} is required.`);
  if (s.length > max) throw new Error(`${label} is too long (max ${max}).`);
  return s;
}

function buildMessage(action, label, wallet, nonce) {
  return [
    `${SITE_NAME} — ${action} ${label}.${SUFFIX}`,
    '',
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    '',
    'No transaction. No fees. This signature only proves wallet ownership.',
  ].join('\n');
}

function verifySig({ action, label, wallet, nonce, signature }) {
  if (!isBase58Pubkey(wallet)) throw new Error('Invalid wallet address.');
  const n = store.nonceGet(nonce);
  if (!n || n.wallet !== wallet) throw new Error('Nonce expired. Try again.');
  if (Date.now() - n.created_at > 10 * 60 * 1000) { store.nonceDel(nonce); throw new Error('Nonce expired. Try again.'); }
  let sigBytes;
  try { sigBytes = Buffer.from(signature, 'base64'); } catch { throw new Error('Bad signature encoding.'); }
  if (sigBytes.length !== 64) throw new Error('Bad signature.');
  const msg = Buffer.from(buildMessage(action, label, wallet, nonce), 'utf8');
  const ok = nacl.sign.detached.verify(new Uint8Array(msg), new Uint8Array(sigBytes), bs58.decode(wallet));
  if (!ok) throw new Error('Signature did not verify.');
  store.nonceDel(nonce);
}

// crude per-IP rate limit for writes
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || 'x';
  const t = Date.now();
  const arr = (hits.get(ip) || []).filter(x => t - x < 60_000);
  arr.push(t);
  hits.set(ip, arr);
  if (arr.length > 40) return res.status(429).json({ error: 'Slow down.' });
  next();
}
setInterval(() => { hits.clear(); store.nonceGc(15 * 60 * 1000); }, 5 * 60 * 1000).unref();

// ---------- seeds (example records) ----------
function seed() {
  const EX_OWNER = 'NomenExamp1e1111111111111111111111111111111';
  const examples = [
    { name: 'milo', ticker: 'MILO', token_name: 'Milo', description: 'The orange cat that started it all. One name, the whole story.', website: 'https://nomen.example' },
    { name: 'agent', ticker: 'AGENT', token_name: 'Agent', description: 'An autonomous trading agent with a human-readable home.' },
    { name: 'cat', ticker: 'CAT', token_name: 'Cat', description: 'Just a cat. Every cat deserves a name.' },
    { name: 'nova', ticker: 'NOVA', token_name: 'Nova', description: 'A bright new thing on Solana.' },
    { name: 'pixel', ticker: 'PXL', token_name: 'Pixel', description: 'Tiny squares, big identity.' },
    { name: 'orbit', ticker: 'ORBIT', token_name: 'Orbit', description: 'Around and around. One canonical home.' },
  ];
  const ts = '2026-10-07T12:00:00.000Z';
  for (const e of examples) {
    if (store.exists(e.name)) continue;
    const kp = nacl.sign.keyPair();
    store.insert({
      name: e.name, ticker: e.ticker, token_name: e.token_name, description: e.description || '',
      mint: bs58.encode(kp.publicKey), mint_kind: 'example', owner: EX_OWNER, creator: EX_OWNER,
      image: null, twitter: null, telegram: null, website: e.website || null, pumpfun: null, community: null,
      status: 'active', example: 1, created_at: ts, updated_at: ts,
    });
  }
}
seed();

// ---------- API ----------
const api = express.Router();
api.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

api.get('/', (req, res) => {
  res.json({
    service: SITE_NAME, suffix: '.' + SUFFIX, version: 1,
    endpoints: {
      resolve: 'GET /api/resolve/:name  (name with or without .mint)',
      reverse: 'GET /api/resolve?mint=<token address>',
      check: 'GET /api/check/:name',
      names: 'GET /api/names?q=&owner=&limit=&offset=',
      stats: 'GET /api/stats',
      nonce: 'POST /api/nonce { wallet }',
      register: 'POST /api/register { ... , wallet, nonce, signature }',
      update: 'POST /api/update { name, links, description, image, wallet, nonce, signature }',
    },
  });
});

api.get('/stats', (req, res) => res.json(store.stats()));

api.get('/resolve', (req, res) => {
  const mint = String(req.query.mint || '');
  if (!isBase58Pubkey(mint)) return res.status(400).json({ error: 'Pass ?mint=<token address>.' });
  const recs = store.byMint(mint);
  if (!recs.length) return res.status(404).json({ error: 'No name points at that address.', mint });
  res.json({ mint, names: recs });
});

api.get('/resolve/:name', (req, res) => {
  const label = normalizeName(req.params.name);
  const c = checkName(label);
  if (!c.ok) return res.status(400).json({ error: c.reason });
  const rec = store.get(label);
  if (!rec) return res.status(404).json({ error: `${label}.${SUFFIX} is not registered.`, name: `${label}.${SUFFIX}`, available: true });
  res.json(rec);
});

api.get('/check/:name', (req, res) => {
  const label = normalizeName(req.params.name);
  const c = checkName(label);
  if (!c.ok) return res.json({ name: label ? `${label}.${SUFFIX}` : null, valid: false, available: false, reason: c.reason });
  const rec = store.get(label);
  if (rec) return res.json({ name: `${label}.${SUFFIX}`, valid: true, available: false, reason: 'Already registered.', record: rec });
  res.json({ name: `${label}.${SUFFIX}`, valid: true, available: true });
});

api.get('/names', (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 60));
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const owner = String(req.query.owner || '');
  const q = String(req.query.q || '').trim().toLowerCase().slice(0, 50);
  let names;
  if (owner) {
    if (!isBase58Pubkey(owner)) return res.status(400).json({ error: 'Invalid owner.' });
    names = store.byOwner(owner);
  } else if (q) names = store.search(q.replace(/[%_]/g, ''), limit, offset);
  else names = store.list(limit, offset);
  res.json({ names, count: names.length, stats: store.stats() });
});

api.get('/recent', (req, res) => res.json({ names: store.recent(12) }));
api.get('/events', (req, res) => res.json({ events: store.events(30) }));

api.post('/nonce', rateLimit, (req, res) => {
  const wallet = String(req.body?.wallet || '');
  if (!isBase58Pubkey(wallet)) return res.status(400).json({ error: 'Invalid wallet address.' });
  const nonce = crypto.randomBytes(16).toString('hex');
  store.nonceInsert(nonce, wallet);
  res.json({ nonce, template: buildMessage('{action}', '{name}', wallet, nonce) });
});

api.post('/message', (req, res) => {
  // Lets the client fetch the exact message to sign (keeps one source of truth).
  const { action, name, wallet, nonce } = req.body || {};
  const label = normalizeName(name);
  if (!['register', 'update', 'transfer'].includes(action)) return res.status(400).json({ error: 'Bad action.' });
  if (!label || !isBase58Pubkey(String(wallet)) || typeof nonce !== 'string') return res.status(400).json({ error: 'Bad request.' });
  res.json({ message: buildMessage(action, label, wallet, nonce) });
});

api.post('/register', rateLimit, (req, res) => {
  try {
    const b = req.body || {};
    const label = normalizeName(b.name);
    const c = checkName(label);
    if (!c.ok) return res.status(400).json({ error: c.reason });
    const wallet = String(b.wallet || '');
    verifySig({ action: 'register', label, wallet, nonce: String(b.nonce || ''), signature: String(b.signature || '') });
    if (store.exists(label)) return res.status(409).json({ error: `${label}.${SUFFIX} was just taken.` });
    if (store.byOwner(wallet).length >= 100) return res.status(400).json({ error: 'This wallet already owns 100 names.' });

    const ticker = cleanText(b.ticker, 12, 'Ticker', true).toUpperCase().replace(/^\$/, '');
    if (!/^[A-Z0-9]{1,12}$/.test(ticker)) return res.status(400).json({ error: 'Ticker: 1–12 letters or numbers.' });
    const tokenName = cleanText(b.tokenName, 40, 'Token name', true);
    const description = cleanText(b.description, 500, 'Description', false);
    const links = cleanLinks(b.links);
    const image = cleanImage(b.image);

    let mint, mintKind;
    if (b.mintKind === 'existing') {
      mint = String(b.mint || '').trim();
      if (!isBase58Pubkey(mint)) return res.status(400).json({ error: 'That is not a valid Solana address.' });
      mintKind = 'existing';
    } else {
      // client may supply its own randomly generated example identifier; otherwise make one
      mint = isBase58Pubkey(String(b.mint || '')) ? String(b.mint) : bs58.encode(nacl.sign.keyPair().publicKey);
      mintKind = 'example';
    }
    const ts = now();
    store.insert({
      name: label, ticker, token_name: tokenName, description, mint, mint_kind: mintKind,
      owner: wallet, creator: wallet, image, ...links, status: 'active', example: 0,
      created_at: ts, updated_at: ts,
    });
    store.event(label, 'register', wallet);
    res.json({ ok: true, record: store.get(label) });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Registration failed.' });
  }
});

api.post('/update', rateLimit, (req, res) => {
  try {
    const b = req.body || {};
    const label = normalizeName(b.name);
    const rec = store.get(label);
    if (!rec) return res.status(404).json({ error: 'Name not found.' });
    const wallet = String(b.wallet || '');
    if (rec.owner !== wallet) return res.status(403).json({ error: 'Only the owner can edit this name.' });
    verifySig({ action: 'update', label, wallet, nonce: String(b.nonce || ''), signature: String(b.signature || '') });
    const links = cleanLinks(b.links === undefined ? rec.links : { ...rec.links, ...b.links });
    const description = b.description === undefined ? rec.description : cleanText(b.description, 500, 'Description', false);
    const image = b.image === undefined ? rec.image : cleanImage(b.image);
    store.update({ name: label, description, image, ...links, updated_at: now() });
    store.event(label, 'update', wallet);
    res.json({ ok: true, record: store.get(label) });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Update failed.' });
  }
});

api.post('/transfer', rateLimit, (req, res) => {
  try {
    const b = req.body || {};
    const label = normalizeName(b.name);
    const rec = store.get(label);
    if (!rec) return res.status(404).json({ error: 'Name not found.' });
    const wallet = String(b.wallet || '');
    const to = String(b.to || '');
    if (rec.owner !== wallet) return res.status(403).json({ error: 'Only the owner can transfer this name.' });
    if (!isBase58Pubkey(to)) return res.status(400).json({ error: 'Invalid destination wallet.' });
    verifySig({ action: 'transfer', label, wallet, nonce: String(b.nonce || ''), signature: String(b.signature || '') });
    store.transfer(label, to);
    store.event(label, 'transfer', wallet);
    res.json({ ok: true, record: store.get(label) });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Transfer failed.' });
  }
});

api.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use('/api', api);

// ---------- pages ----------
const pages = {
  '/': 'index.html', '/explore': 'explore.html', '/names': 'names.html',
  '/resolver': 'resolver.html', '/launch': 'launch.html', '/how-it-works': 'index.html', '/api-docs': 'api.html',
};
for (const [route, file] of Object.entries(pages)) {
  app.get(route, (req, res) => res.sendFile(path.join(PUBLIC_DIR, file)));
}

const NAME_TPL = fs.readFileSync(path.join(PUBLIC_DIR, 'name.html'), 'utf8');
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
app.get(['/n/:name', '/:name.mint'], (req, res) => {
  const label = normalizeName(req.params.name);
  const rec = checkName(label).ok ? store.get(label) : null;
  const title = rec ? `${rec.name} · $${rec.ticker} · ${SITE_NAME}` : `${label ? label + '.mint' : 'Name'} · ${SITE_NAME}`;
  const desc = rec ? (rec.description || `${rec.tokenName} ($${rec.ticker}) on Solana. Canonical record on ${SITE_NAME}.`) : `This .mint name is available on ${SITE_NAME}.`;
  const html = NAME_TPL.replace(/{{TITLE}}/g, esc(title)).replace(/{{DESC}}/g, esc(desc)).replace(/{{LABEL}}/g, esc(label || ''));
  res.set('Content-Type', 'text/html; charset=utf-8').send(html);
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: '1h' }));
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));

app.listen(PORT, () => console.log(`${SITE_NAME} listening on :${PORT} — db ${store.DB_PATH}`));
