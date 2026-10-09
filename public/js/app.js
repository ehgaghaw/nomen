/* Nomen — shared client runtime: nav, footer, wallet, API, helpers. */
(function () {
  const SUFFIX = 'mint';
  const X_HANDLE = 'nomenmint';

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = (a, n = 4) => a ? `${a.slice(0, n)}…${a.slice(-n)}` : '';
  const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; } };
  const fmtDateTime = (iso) => { try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; } };

  function toast(msg, isErr) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.toggle('err', !!isErr); t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2800);
  }
  async function copy(text, label = 'Copied') {
    try { await navigator.clipboard.writeText(text); toast(label); } catch { toast('Copy failed', true); }
  }

  // Deterministic avatar when a record has no image: gradient + initials.
  const PALETTES = [
    ['#39f2a6', '#0f9d6b'], ['#f5c76b', '#d98a2b'], ['#8fb3ff', '#4b6fd8'], ['#ff9ad5', '#c74f9a'],
    ['#9cf0ff', '#2fa6c2'], ['#c9ff7a', '#6fb12b'], ['#ffb380', '#e06a2e'], ['#d6b2ff', '#8a5be0'],
  ];
  function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function avatar(rec, size = '') {
    const label = rec.label || rec.name?.replace('.' + SUFFIX, '') || '?';
    if (rec.image) return `<div class="avatar ${size}"><img src="${esc(rec.image)}" alt="${esc(label)}"></div>`;
    const [a, b] = PALETTES[hashStr(label) % PALETTES.length];
    const initials = (rec.ticker || label).slice(0, 2).toUpperCase();
    return `<div class="avatar ${size}" style="background:linear-gradient(135deg,${a},${b})">${esc(initials)}</div>`;
  }

  function nameHtml(label) { return `${esc(label)}<span>.${SUFFIX}</span>`; }

  function card(rec) {
    const label = rec.label;
    return `<a class="card fade-in" href="/n/${esc(label)}">
      <div class="top">${avatar(rec)}<span class="badge ${rec.example ? 'muted' : ''}">${rec.example ? 'example' : rec.status}</span></div>
      <div><div class="nm">${nameHtml(label)}</div><div class="tk">$${esc(rec.ticker)}</div></div>
      ${rec.description ? `<div class="desc">${esc(rec.description)}</div>` : ''}
      <div class="foot"><span>${rec.example ? 'EXAMPLE' : short(rec.owner)} · ${fmtDate(rec.createdAt)}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17 17 7M8 7h9v9"/></svg></div>
    </a>`;
  }

  // ---------- API ----------
  async function api(path, opts) {
    const r = await fetch('/api' + path, opts ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts) } : undefined);
    const j = await r.json().catch(() => ({ error: 'Bad response' }));
    if (!r.ok) { const e = new Error(j.error || 'Request failed'); e.status = r.status; e.body = j; throw e; }
    return j;
  }

  // ---------- wallet ----------
  const wallet = {
    provider: null, pubkey: null, name: null,
    listeners: new Set(),
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    emit() { for (const fn of this.listeners) try { fn(this.pubkey); } catch (e) { console.error(e); } renderNavWallet(); },
    detect() {
      const w = window;
      const list = [
        { id: 'phantom', name: 'Phantom', p: w.phantom?.solana?.isPhantom ? w.phantom.solana : (w.solana?.isPhantom ? w.solana : null), color: '#ab9ff2', url: 'https://phantom.app' },
        { id: 'solflare', name: 'Solflare', p: w.solflare?.isSolflare ? w.solflare : null, color: '#fc7227', url: 'https://solflare.com' },
        { id: 'backpack', name: 'Backpack', p: w.backpack?.isBackpack ? w.backpack : null, color: '#e33e3f', url: 'https://backpack.app' },
      ];
      // generic injected provider fallback
      if (w.solana && !list.some(x => x.p === w.solana)) list.push({ id: 'injected', name: 'Injected wallet', p: w.solana, color: '#39f2a6' });
      return list;
    },
    async connect(pref) {
      const opts = this.detect();
      const available = opts.filter(o => o.p);
      let choice = pref ? opts.find(o => o.id === pref) : null;
      if (!choice) {
        if (available.length === 0) { openModal(opts); return null; }
        if (available.length === 1 && !pref) choice = available[0];
        else { openModal(opts); return null; }
      }
      if (!choice.p) { window.open(choice.url, '_blank'); return null; }
      const resp = await choice.p.connect();
      const pk = (resp?.publicKey || choice.p.publicKey);
      this.provider = choice.p; this.pubkey = pk.toString(); this.name = choice.name;
      try { localStorage.setItem('nomen.wallet', choice.id); } catch {}
      choice.p.on?.('disconnect', () => this.disconnect(true));
      choice.p.on?.('accountChanged', (k) => { if (k) { this.pubkey = k.toString(); this.emit(); } else this.disconnect(true); });
      closeModal();
      this.emit();
      return this.pubkey;
    },
    async disconnect(silent) {
      try { await this.provider?.disconnect?.(); } catch {}
      this.provider = null; this.pubkey = null; this.name = null;
      try { localStorage.removeItem('nomen.wallet'); } catch {}
      this.emit();
      if (!silent) toast('Wallet disconnected');
    },
    async autoConnect() {
      let id = null; try { id = localStorage.getItem('nomen.wallet'); } catch {}
      if (!id) return;
      const o = this.detect().find(x => x.id === id);
      if (!o?.p) return;
      try {
        const resp = await o.p.connect({ onlyIfTrusted: true });
        const pk = resp?.publicKey || o.p.publicKey;
        if (!pk) return;
        this.provider = o.p; this.pubkey = pk.toString(); this.name = o.name;
        o.p.on?.('disconnect', () => this.disconnect(true));
        o.p.on?.('accountChanged', (k) => { if (k) { this.pubkey = k.toString(); this.emit(); } else this.disconnect(true); });
        this.emit();
      } catch {}
    },
    // Request a nonce, build the canonical message, sign it, return {nonce, signature}.
    async sign(action, label) {
      if (!this.provider || !this.pubkey) throw new Error('Connect a wallet first.');
      const { nonce } = await api('/nonce', { wallet: this.pubkey });
      const { message } = await api('/message', { action, name: label, wallet: this.pubkey, nonce });
      const bytes = new TextEncoder().encode(message);
      const res = await this.provider.signMessage(bytes, 'utf8');
      const sig = res?.signature || res;
      const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
      return { nonce, signature: b64 };
    },
  };

  function openModal(opts) {
    let bg = $('#wallet-modal');
    if (!bg) {
      bg = document.createElement('div'); bg.id = 'wallet-modal'; bg.className = 'modal-bg';
      bg.addEventListener('click', (e) => { if (e.target === bg) closeModal(); });
      document.body.appendChild(bg);
    }
    bg.innerHTML = `<div class="modal"><h3>Connect a wallet.</h3><p>Used for identity only. Registering a name asks for one message signature. No transactions, no fees.</p>
      <div class="wlist">${opts.filter(o => o.id !== 'injected' || o.p).map(o => `
        <div class="wopt" data-id="${o.id}"><span class="l"><span class="ico" style="background:${o.color};color:#0a0c0b">${o.name[0]}</span>${o.name}</span>
        <span class="ins ${o.p ? 'yes' : ''}">${o.p ? 'Detected' : 'Install'}</span></div>`).join('')}</div></div>`;
    $$('.wopt', bg).forEach(el => el.addEventListener('click', () => wallet.connect(el.dataset.id).catch(e => toast(e.message || 'Connection rejected', true))));
    bg.classList.add('open');
  }
  function closeModal() { $('#wallet-modal')?.classList.remove('open'); }

  // ---------- nav / footer ----------
  const LOGO = `<svg class="mark" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#39f2a6"/><path d="M8 16V8l8 8V8" stroke="#052016" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const XICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2H22l-7.2 8.3L23 22h-6.6l-5.2-6.8L5.2 22H2l7.7-8.8L1 2h6.8l4.7 6.2L18.9 2Zm-1.2 18h1.8L6.4 3.9H4.5L17.7 20Z"/></svg>`;

  function renderNav() {
    const path = location.pathname;
    const links = [['/explore', 'Explore'], ['/names', 'Names'], ['/resolver', 'Resolver'], ['/launch', 'Launch'], ['/#how-it-works', 'How it works']];
    const nav = document.createElement('header'); nav.className = 'nav';
    nav.innerHTML = `<div class="container">
      <a class="brand" href="/">${LOGO}nomen<span class="ast">✳</span></a>
      <nav class="nav-links" id="nav-links">${links.map(([h, t]) => `<a href="${h}" class="${path === h ? 'active' : ''}">${t}</a>`).join('')}
        <a href="https://x.com/${X_HANDLE}" target="_blank" rel="noopener" aria-label="X">${XICON}</a></nav>
      <div class="nav-right"><span id="nav-wallet"></span><button class="nav-toggle" id="nav-toggle" aria-label="Menu">☰</button></div></div>`;
    document.body.prepend(nav);
    $('#nav-toggle').addEventListener('click', () => $('#nav-links').classList.toggle('open'));
    renderNavWallet();
  }
  function renderNavWallet() {
    const el = $('#nav-wallet'); if (!el) return;
    if (wallet.pubkey) {
      el.innerHTML = `<span class="wallet-chip" title="Disconnect"><span class="dot"></span>${short(wallet.pubkey)}</span>`;
      $('.wallet-chip', el).addEventListener('click', () => wallet.disconnect());
    } else {
      el.innerHTML = `<button class="btn light sm" id="nav-connect"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M16 12h5M3 10h18"/></svg><span class="lbl">Connect wallet</span></button>`;
      $('#nav-connect').addEventListener('click', () => wallet.connect().catch(e => toast(e.message || 'Connection rejected', true)));
    }
  }
  function renderFooter() {
    const f = document.createElement('footer'); f.className = 'footer';
    f.innerHTML = `<div class="container"><div class="left"><a class="brand" href="/">${LOGO}nomen<span class="ast">✳</span></a>
      <span>Every token deserves a name.</span>
      <a href="https://x.com/${X_HANDLE}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px">${XICON}@${X_HANDLE}</a>
      <a href="/api-docs">API</a></div>
      <span class="caps">Every token gets a name.</span></div>`;
    document.body.appendChild(f);
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderNav(); renderFooter();
    wallet.autoConnect();
  });

  window.Nomen = { SUFFIX, $, $$, esc, short, fmtDate, fmtDateTime, toast, copy, avatar, card, nameHtml, api, wallet, openModal, XICON };
})();
