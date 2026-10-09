/* Nomen — shared client runtime: nav, footer, wallet, API, logos, motion. */
(function () {
  document.documentElement.classList.add('js');
  const SUFFIX = 'coin';
  const X_HANDLE = 'nomenapp';
  const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  // ---------- generated logos ----------
  // Every token without an uploaded image still gets a unique little mascot, derived from its name.
  const LOGO_PAL = [
    ['#ffe2c6', '#f28c3a'], ['#dce8ff', '#5b8def'], ['#e1f4d4', '#79c255'], ['#fff1c2', '#f2b51f'],
    ['#efe3ff', '#9a6cf0'], ['#d6f4ef', '#2bb3a0'], ['#ffe0ea', '#ef5f8f'], ['#e6ebf1', '#5c6b7a'],
  ];
  function hashStr(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function genLogo(seed) {
    const h = hashStr(seed || '?');
    const [bg, fg] = LOGO_PAL[h % LOGO_PAL.length];
    const shape = (h >>> 3) % 5, eyes = (h >>> 6) % 3, mouth = (h >>> 9) % 3, extra = (h >>> 12) % 4;
    const ink = '#1d2421';
    let body = '';
    if (shape === 0) body = `<circle cx="32" cy="35" r="20" fill="${fg}"/>`;
    else if (shape === 1) body = `<rect x="12" y="15" width="40" height="40" rx="13" fill="${fg}"/>`;
    else if (shape === 2) body = `<path d="M32 13 C46 13 53 24 52 36 C51 49 42 55 32 55 C21 55 12 48 12 36 C12 23 19 13 32 13Z" fill="${fg}"/>`;
    else if (shape === 3) body = `<polygon points="32,12 51,23 51,46 32,57 13,46 13,23" fill="${fg}"/>`;
    else body = `<path d="M14 54 V32 a18 18 0 0 1 36 0 V54 l-6 -4 -6 4 -6 -4 -6 4 -6 -4Z" fill="${fg}"/>`;
    let top = '';
    if (extra === 0) top = `<path d="M17 24 L19 8 L29 17Z M47 24 L45 8 L35 17Z" fill="${fg}"/>`;
    else if (extra === 1) top = `<line x1="32" y1="6" x2="32" y2="15" stroke="${fg}" stroke-width="2.6" stroke-linecap="round"/><circle cx="32" cy="6" r="3.4" fill="${ink}"/>`;
    else if (extra === 2) top = `<path d="M24 14 q8 -9 16 0" stroke="${fg}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    let e = '';
    if (eyes === 0) e = `<circle cx="25" cy="34" r="3.3" fill="${ink}"/><circle cx="39" cy="34" r="3.3" fill="${ink}"/><circle cx="26.2" cy="32.8" r="1" fill="#fff"/><circle cx="40.2" cy="32.8" r="1" fill="#fff"/>`;
    else if (eyes === 1) e = `<ellipse cx="25" cy="34" rx="5" ry="5.4" fill="#fff"/><ellipse cx="39" cy="34" rx="5" ry="5.4" fill="#fff"/><circle cx="26" cy="35" r="2.5" fill="${ink}"/><circle cx="40" cy="35" r="2.5" fill="${ink}"/>`;
    else e = `<path d="M21 35 q4 -5 8 0 M35 35 q4 -5 8 0" stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
    let m = '';
    if (mouth === 0) m = `<path d="M27 43 q5 4.5 10 0" stroke="${ink}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    else if (mouth === 1) m = `<ellipse cx="32" cy="44" rx="2.6" ry="3" fill="${ink}"/>`;
    else m = `<path d="M28 43 q2 2 4 0 q2 2 4 0" stroke="${ink}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
    const blush = `<circle cx="19" cy="41" r="2.6" fill="#fff" opacity=".35"/><circle cx="45" cy="41" r="2.6" fill="#fff" opacity=".35"/>`;
    return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect width="64" height="64" fill="${bg}"/>${top}${body}${blush}${e}${m}</svg>`;
  }
  function avatar(rec, size = '') {
    const label = rec.label || (rec.name || '').replace('.' + SUFFIX, '') || '?';
    if (rec.image) return `<div class="avatar ${size}"><img src="${esc(rec.image)}" alt="${esc(label)}" loading="lazy"></div>`;
    return `<div class="avatar ${size}">${genLogo(label)}</div>`;
  }
  function logoSrc(rec) {
    if (rec.image) return rec.image;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(genLogo(rec.label));
  }

  function nameHtml(label) { return `${esc(label)}<span>.${SUFFIX}</span>`; }

  function card(rec, i = 0) {
    const label = rec.label;
    return `<a class="card fade-in" style="--d:${(i % 8) * 0.07}s" href="/n/${esc(label)}">
      <div class="top">${avatar(rec)}<span class="badge">${esc(rec.status)}</span></div>
      <div><div class="nm">${nameHtml(label)}</div><div class="tk">$${esc(rec.ticker)}</div></div>
      ${rec.description ? `<div class="desc">${esc(rec.description)}</div>` : ''}
      <div class="foot"><span>${rec.example ? 'Example' : short(rec.owner)} · ${fmtDate(rec.createdAt)}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17 17 7M8 7h9v9"/></svg></div>
    </a>`;
  }

  // ---------- motion ----------
  let io = null;
  function reveal(root = document) {
    const SEL = '[data-reveal], .steps, [data-count], pre.typing';
    const els = [...(root !== document && root.matches && root.matches(SEL) ? [root] : []), ...$$(SEL, root)].filter(el => !el._obs);
    if (REDUCED || !('IntersectionObserver' in window)) {
      els.forEach(el => { el._obs = true; el.classList.add('in', 'go'); if (el.dataset.count) countUp(el, +el.dataset.count); setTimeout(() => el.dispatchEvent(new CustomEvent('reveal'))); });
      return;
    }
    if (!io) io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const el = en.target; el.classList.add('in', 'go'); io.unobserve(el);
        if (el.dataset.count !== undefined) countUp(el, +el.dataset.count);
        el.dispatchEvent(new CustomEvent('reveal'));
      }
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    els.forEach(el => { el._obs = true; io.observe(el); });
  }
  function onReveal(el, fn) { if (el.classList.contains('in')) fn(); else el.addEventListener('reveal', fn, { once: true }); }
  function countUp(el, to, ms = 1100) {
    if (REDUCED || !to) { el.textContent = to; return; }
    const t0 = performance.now();
    const tick = (t) => { const p = Math.min(1, (t - t0) / ms); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  function confetti(n = 90) {
    if (REDUCED) return;
    const box = document.createElement('div'); box.className = 'confetti';
    const cols = ['#00a76f', '#f2b51f', '#5b8def', '#ef5f8f', '#9a6cf0', '#0c1410'];
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + 'vw'; p.style.background = cols[i % cols.length];
      p.style.setProperty('--x', (Math.random() * 200 - 100) + 'px'); p.style.setProperty('--r', (Math.random() * 900 - 450) + 'deg');
      p.style.setProperty('--d', (Math.random() * 0.5) + 's'); p.style.setProperty('--t', (1.8 + Math.random() * 1.6) + 's');
      box.appendChild(p);
    }
    document.body.appendChild(box); setTimeout(() => box.remove(), 4200);
  }

  // ---------- API ----------
  async function api(path, opts) {
    const r = await fetch('/api' + path, opts ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts) } : undefined);
    const j = await r.json().catch(() => ({ error: 'Bad response' }));
    if (!r.ok) { const e = new Error(j.error || 'Request failed'); e.status = r.status; e.body = j; throw e; }
    return j;
  }

  // ---------- wallet ----------
  const WICON = {
    phantom: `<svg viewBox="0 0 32 32"><rect width="32" height="32" fill="#ab9ff2"/><path d="M7 21.5c0-6.6 4.3-12 10-12s9 4.2 9 9.3c0 .9-.7 1.7-1.6 1.7h-.5c-.6 0-1 .4-1 1v1.1c0 .9-.7 1.6-1.6 1.6s-1.6-.7-1.6-1.6v-.4c0-.6-.5-1-1-1s-1 .4-1 1v.4c0 .9-.7 1.6-1.6 1.6s-1.6-.7-1.6-1.6v-.4c0-.6-.5-1-1-1s-1 .4-1 1c0 .9-.7 1.6-1.6 1.6C7.7 23.8 7 23 7 21.5Z" fill="#fff"/><ellipse cx="16" cy="16" rx="1.3" ry="2" fill="#ab9ff2"/><ellipse cx="20.5" cy="16" rx="1.3" ry="2" fill="#ab9ff2"/></svg>`,
    solflare: `<svg viewBox="0 0 32 32"><rect width="32" height="32" fill="#fff4e0"/><circle cx="16" cy="16" r="7" fill="#fc7227"/><g stroke="#ffc22e" stroke-width="2.4" stroke-linecap="round"><path d="M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M6.8 25.2l2.8-2.8M22.4 9.6l2.8-2.8"/></g></svg>`,
    backpack: `<svg viewBox="0 0 32 32"><rect width="32" height="32" fill="#e33e3f"/><rect x="9" y="11" width="14" height="15" rx="4" fill="#fff"/><path d="M12.5 11V9.5a3.5 3.5 0 0 1 7 0V11" stroke="#fff" stroke-width="2" fill="none"/><rect x="12" y="17" width="8" height="4" rx="1.5" fill="#e33e3f"/></svg>`,
    injected: `<svg viewBox="0 0 32 32"><rect width="32" height="32" fill="#e7f8f0"/><rect x="7" y="10" width="18" height="13" rx="3" fill="none" stroke="#00a76f" stroke-width="2"/><path d="M19 16.5h6" stroke="#00a76f" stroke-width="2"/></svg>`,
  };
  const wallet = {
    provider: null, pubkey: null, name: null,
    listeners: new Set(),
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    emit() { for (const fn of this.listeners) try { fn(this.pubkey); } catch (e) { console.error(e); } renderNavWallet(); },
    detect() {
      const w = window;
      const list = [
        { id: 'phantom', name: 'Phantom', p: w.phantom?.solana?.isPhantom ? w.phantom.solana : (w.solana?.isPhantom ? w.solana : null), url: 'https://phantom.app' },
        { id: 'solflare', name: 'Solflare', p: w.solflare?.isSolflare ? w.solflare : null, url: 'https://solflare.com' },
        { id: 'backpack', name: 'Backpack', p: w.backpack?.isBackpack ? w.backpack : null, url: 'https://backpack.app' },
      ];
      if (w.solana && !list.some(x => x.p === w.solana)) list.push({ id: 'injected', name: 'Injected wallet', p: w.solana });
      return list;
    },
    bind(p) {
      p.on?.('disconnect', () => this.disconnect(true));
      p.on?.('accountChanged', (k) => { if (k) { this.pubkey = k.toString(); this.emit(); } else this.disconnect(true); });
    },
    async connect(pref) {
      const opts = this.detect();
      const available = opts.filter(o => o.p);
      let choice = pref ? opts.find(o => o.id === pref) : null;
      if (!choice) {
        if (available.length === 1) choice = available[0];
        else { openModal(opts); return null; }
      }
      if (!choice.p) { window.open(choice.url, '_blank'); return null; }
      const resp = await choice.p.connect();
      const pk = (resp?.publicKey || choice.p.publicKey);
      this.provider = choice.p; this.pubkey = pk.toString(); this.name = choice.name;
      try { localStorage.setItem('nomen.wallet', choice.id); } catch {}
      this.bind(choice.p);
      closeModal(); this.emit(); toast(`Connected ${short(this.pubkey)}`);
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
        this.bind(o.p); this.emit();
      } catch {}
    },
    // Request a nonce, fetch the canonical message, sign it, return {nonce, signature}.
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
        <div class="wopt" data-id="${o.id}"><span class="l"><span class="ico">${WICON[o.id] || WICON.injected}</span>${o.name}</span>
        <span class="ins ${o.p ? 'yes' : ''}">${o.p ? 'Detected' : 'Install ↗'}</span></div>`).join('')}</div></div>`;
    $$('.wopt', bg).forEach(el => el.addEventListener('click', () => wallet.connect(el.dataset.id).catch(e => toast(e.message || 'Connection rejected', true))));
    bg.classList.add('open');
  }
  function closeModal() { $('#wallet-modal')?.classList.remove('open'); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.modal-bg.open').forEach(m => m.classList.remove('open')); });

  // ---------- nav / footer ----------
  const LOGO = `<svg class="mark" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#00a76f"/><path d="M8 16V8l8 8V8" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const XICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2H22l-7.2 8.3L23 22h-6.6l-5.2-6.8L5.2 22H2l7.7-8.8L1 2h6.8l4.7 6.2L18.9 2Zm-1.2 18h1.8L6.4 3.9H4.5L17.7 20Z"/></svg>`;
  const BRAND = `<a class="brand" href="/">${LOGO}nomen<span class="ast">✳</span></a>`;

  function renderNav() {
    const path = location.pathname;
    const links = [['/explore', 'Explore'], ['/names', 'Names'], ['/resolver', 'Resolver'], ['/launch', 'Launch'], ['/#how-it-works', 'How it works']];
    const nav = document.createElement('header'); nav.className = 'nav';
    nav.innerHTML = `<div class="container">${BRAND}
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
      el.innerHTML = `<button class="btn dark sm" id="nav-connect"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M16 12h5M3 10h18"/></svg><span class="lbl">Connect wallet</span></button>`;
      $('#nav-connect').addEventListener('click', () => wallet.connect().catch(e => toast(e.message || 'Connection rejected', true)));
    }
  }
  function renderFooter() {
    const f = document.createElement('footer'); f.className = 'footer';
    f.innerHTML = `<div class="container"><div class="left">${BRAND}
      <span>Every token deserves a name.</span>
      <a href="https://x.com/${X_HANDLE}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;color:var(--text)">${XICON}@${X_HANDLE}</a>
      <a href="/api-docs">API</a></div>
      <span class="caps">Every token gets a name.</span></div>`;
    document.body.appendChild(f);
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderNav(); renderFooter(); reveal();
    wallet.autoConnect();
  });

  window.Nomen = { SUFFIX, REDUCED, $, $$, esc, short, fmtDate, fmtDateTime, toast, copy, avatar, genLogo, logoSrc, card, nameHtml, api, wallet, openModal, reveal, onReveal, countUp, confetti, XICON };
})();
