// Nomen registry storage — SQLite via Node's built-in node:sqlite (no native build step).
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'nomen.db');

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS names (
    name        TEXT PRIMARY KEY,
    ticker      TEXT NOT NULL,
    token_name  TEXT NOT NULL,
    description TEXT DEFAULT '',
    mint        TEXT NOT NULL,
    mint_kind   TEXT NOT NULL DEFAULT 'example',
    owner       TEXT NOT NULL,
    creator     TEXT NOT NULL,
    image       TEXT,
    twitter     TEXT,
    telegram    TEXT,
    website     TEXT,
    pumpfun     TEXT,
    community   TEXT,
    status      TEXT NOT NULL DEFAULT 'active',
    example     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_names_owner ON names(owner);
  CREATE INDEX IF NOT EXISTS idx_names_created ON names(created_at);
  CREATE TABLE IF NOT EXISTS nonces (
    nonce      TEXT PRIMARY KEY,
    wallet     TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL,
    wallet     TEXT,
    created_at TEXT NOT NULL
  );
`);

const COLS = [
  'name', 'ticker', 'token_name', 'description', 'mint', 'mint_kind', 'owner', 'creator',
  'image', 'twitter', 'telegram', 'website', 'pumpfun', 'community', 'status', 'example',
  'created_at', 'updated_at',
];

const stmts = {
  get: db.prepare('SELECT * FROM names WHERE name = ?'),
  insert: db.prepare(`INSERT INTO names (${COLS.join(',')}) VALUES (${COLS.map(c => '@' + c).join(',')})`),
  update: db.prepare(`UPDATE names SET description=@description, image=@image, twitter=@twitter,
     telegram=@telegram, website=@website, pumpfun=@pumpfun, community=@community, updated_at=@updated_at
     WHERE name=@name`),
  transfer: db.prepare('UPDATE names SET owner=@owner, updated_at=@updated_at WHERE name=@name'),
  byOwner: db.prepare('SELECT * FROM names WHERE owner = ? ORDER BY created_at DESC'),
  byMint: db.prepare('SELECT * FROM names WHERE mint = ? ORDER BY created_at ASC'),
  list: db.prepare('SELECT * FROM names ORDER BY example ASC, created_at DESC LIMIT ? OFFSET ?'),
  search: db.prepare(`SELECT * FROM names WHERE name LIKE ? OR ticker LIKE ? OR token_name LIKE ? OR mint LIKE ?
     ORDER BY example ASC, created_at DESC LIMIT ? OFFSET ?`),
  count: db.prepare('SELECT COUNT(*) AS n FROM names'),
  countReal: db.prepare('SELECT COUNT(*) AS n FROM names WHERE example = 0'),
  countOwners: db.prepare('SELECT COUNT(DISTINCT owner) AS n FROM names WHERE example = 0'),
  recent: db.prepare('SELECT * FROM names ORDER BY created_at DESC LIMIT ?'),
  nonceInsert: db.prepare('INSERT INTO nonces (nonce, wallet, created_at) VALUES (?, ?, ?)'),
  nonceGet: db.prepare('SELECT * FROM nonces WHERE nonce = ?'),
  nonceDel: db.prepare('DELETE FROM nonces WHERE nonce = ?'),
  nonceGc: db.prepare('DELETE FROM nonces WHERE created_at < ?'),
  event: db.prepare('INSERT INTO events (name, kind, wallet, created_at) VALUES (?, ?, ?, ?)'),
  events: db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?'),
};

function rowToRecord(r) {
  if (!r) return null;
  return {
    name: r.name + '.mint',
    label: r.name,
    ticker: r.ticker,
    tokenName: r.token_name,
    description: r.description || '',
    mint: r.mint,
    mintKind: r.mint_kind,
    owner: r.owner,
    creator: r.creator,
    image: r.image || null,
    links: {
      twitter: r.twitter || null,
      telegram: r.telegram || null,
      website: r.website || null,
      pumpfun: r.pumpfun || null,
      community: r.community || null,
    },
    status: r.status,
    example: !!r.example,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

module.exports = {
  db,
  DB_PATH,
  get: (name) => rowToRecord(stmts.get.get(name)),
  exists: (name) => !!stmts.get.get(name),
  insert: (rec) => stmts.insert.run(rec),
  update: (rec) => stmts.update.run(rec),
  transfer: (name, owner) => stmts.transfer.run({ name, owner, updated_at: new Date().toISOString() }),
  byOwner: (owner) => stmts.byOwner.all(owner).map(rowToRecord),
  byMint: (mint) => stmts.byMint.all(mint).map(rowToRecord),
  list: (limit, offset) => stmts.list.all(limit, offset).map(rowToRecord),
  search: (q, limit, offset) => {
    const like = `%${q}%`;
    return stmts.search.all(like, like, like, like, limit, offset).map(rowToRecord);
  },
  recent: (n) => stmts.recent.all(n).map(rowToRecord),
  stats: () => ({
    total: stmts.count.get().n,
    registered: stmts.countReal.get().n,
    owners: stmts.countOwners.get().n,
  }),
  nonceInsert: (nonce, wallet) => stmts.nonceInsert.run(nonce, wallet, Date.now()),
  nonceGet: (nonce) => stmts.nonceGet.get(nonce),
  nonceDel: (nonce) => stmts.nonceDel.run(nonce),
  nonceGc: (olderThanMs) => stmts.nonceGc.run(Date.now() - olderThanMs),
  event: (name, kind, wallet) => stmts.event.run(name, kind, wallet || null, new Date().toISOString()),
  events: (n) => stmts.events.all(n),
};
