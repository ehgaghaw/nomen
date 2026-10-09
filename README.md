# Nomen — every token gets a name

A naming layer for Solana tokens. Claim `ticker.mint`, point it at a token address, and share one memorable identity page instead of a contract address.

- **Registry** — public, server-side (SQLite via `node:sqlite`). Names are global, not per-browser.
- **Ownership** — proven by one ed25519 `signMessage` from a Solana wallet (Phantom, Solflare, Backpack). No transaction, no fee.
- **Resolver API** — `GET /api/resolve/milo.mint`, reverse lookup by mint, search, availability. CORS on, no key.
- **Identity pages** — `/n/milo` with OG tags.

## Run

```
npm install
npm start          # http://localhost:3000
```

Env: `PORT` (default 3000), `DATA_DIR` (where `nomen.db` lives; mount a Railway volume here).
