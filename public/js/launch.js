(function () {
  const { $, $$, esc, api, wallet, toast, avatar, nameHtml, short, copy } = Nomen;

  // ---------- tiny base58 (for example-address generation + format validation) ----------
  const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58encode(bytes) {
    const digits = [0];
    for (const b of bytes) {
      let carry = b;
      for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
      while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    let s = ''; for (const b of bytes) { if (b === 0) s += '1'; else break; }
    return s + digits.reverse().map(d => ALPHA[d]).join('');
  }
  function b58decodeLen(str) {
    if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(str)) return -1;
    const bytes = [0];
    for (const ch of str) {
      let carry = ALPHA.indexOf(ch);
      for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
      while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
    }
    let lead = 0; for (const ch of str) { if (ch === '1') lead++; else break; }
    return lead + bytes.length - (bytes.length > 1 && bytes[bytes.length - 1] === 0 ? 1 : 0);
  }
  const randomMint = () => b58encode(crypto.getRandomValues(new Uint8Array(32)));
  const isPubkey = (s) => typeof s === 'string' && s.length >= 32 && s.length <= 44 && b58decodeLen(s) === 32;

  // ---------- state ----------
  const DRAFT_KEY = 'nomen.draft';
  let S = { step: 1, image: null, tokenName: '', ticker: '', description: '', label: '', nameOk: false, mintKind: 'example', mint: '', exampleMint: randomMint(), links: {} };
  try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); if (d && d.v === 1) S = { ...S, ...d.s, step: 1, nameOk: false }; } catch {}
  const params = new URLSearchParams(location.search);
  if (params.get('name')) { S.label = params.get('name').toLowerCase().replace(/\.mint$/, '').replace(/[^a-z0-9-]/g, ''); if (!S.ticker) S.ticker = S.label.replace(/-/g, '').slice(0, 12).toUpperCase(); if (!S.tokenName) S.tokenName = S.label.charAt(0).toUpperCase() + S.label.slice(1); }
  if (params.get('mint') && isPubkey(params.get('mint'))) { S.mintKind = 'existing'; S.mint = params.get('mint'); }
  function save() { try { const { step, nameOk, ...rest } = S; localStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 1, s: rest })); } catch {} }

  // ---------- step navigation ----------
  function show(n) {
    S.step = n;
    $$('[data-step]').forEach(s => s.classList.toggle('hidden', +s.dataset.step !== n));
    $$('.wstep').forEach(w => { const k = +w.dataset.s; w.classList.toggle('active', k === n); w.classList.toggle('done', k < n); });
    $('#progress').textContent = `0${n} / 06`;
    if (n === 2) { $('#label').value = S.label; checkName(); }
    if (n === 3) renderStep3();
    if (n === 5) renderRecord();
    if (n === 6) renderRegister();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $$('.wstep').forEach(w => w.addEventListener('click', () => { if (w.classList.contains('done')) show(+w.dataset.s); }));
  $$('[data-back]').forEach(b => b.addEventListener('click', () => show(S.step - 1)));
  $$('[data-next]').forEach(b => b.addEventListener('click', () => { if (validate(S.step)) { save(); show(S.step + 1); } }));

  function err(id, msg) { const e = $('#' + id); if (!e) return; e.textContent = msg || ''; e.classList.toggle('hidden', !msg); }

  function validate(n) {
    if (n === 1) {
      S.tokenName = $('#tokenName').value.trim(); S.ticker = $('#ticker').value.trim().toUpperCase().replace(/^\$/, ''); S.description = $('#description').value.trim();
      if (!S.tokenName) return err('err1', 'Give your token a name.'), false;
      if (!/^[A-Z0-9]{1,12}$/.test(S.ticker)) return err('err1', 'Ticker: 1–12 letters or numbers.'), false;
      err('err1', '');
      if (!S.label) S.label = S.ticker.toLowerCase();
      return true;
    }
    if (n === 2) return S.nameOk;
    if (n === 3) {
      if (S.mintKind === 'existing') {
        S.mint = $('#mint').value.trim();
        if (!isPubkey(S.mint)) { $('#mint').classList.add('err'); $('#mint-help').textContent = 'That is not a valid Solana address.'; $('#mint-help').className = 'help err'; return false; }
      } else S.mint = S.exampleMint;
      return true;
    }
    if (n === 4) {
      const L = {}; for (const k of ['twitter', 'telegram', 'website', 'pumpfun', 'community']) L[k] = $('#l-' + k).value.trim() || null;
      const bad = Object.entries(L).find(([k, v]) => v && !/^(https?:\/\/)?[\w.-]+\.[a-z]{2,}([\/?#].*)?$/i.test(v));
      if (bad) return err('err4', `That ${bad[0]} link does not look like a URL.`), false;
      err('err4', ''); S.links = L; return true;
    }
    return true;
  }

  // ---------- step 1: image + fields ----------
  $('#tokenName').value = S.tokenName; $('#ticker').value = S.ticker; $('#description').value = S.description; $('#desc-count').textContent = S.description.length;
  $('#description').addEventListener('input', e => $('#desc-count').textContent = e.target.value.length);
  $('#ticker').addEventListener('input', e => e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  function renderImg() {
    const p = $('#img-prev');
    p.innerHTML = S.image ? `<img src="${S.image}" alt="">` : (S.ticker ? esc(S.ticker[0]) : '?');
    $('#img-clear').classList.toggle('hidden', !S.image);
  }
  renderImg();
  $('#img-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 2 * 1024 * 1024) return toast('Image must be under 2 MB', true);
    try {
      const url = URL.createObjectURL(f); const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const side = Math.min(img.naturalWidth, img.naturalHeight), size = 320;
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      let data = c.toDataURL('image/webp', 0.85); if (!data.startsWith('data:image/webp')) data = c.toDataURL('image/jpeg', 0.85);
      if (data.length > 380_000) data = c.toDataURL('image/jpeg', 0.6);
      S.image = data; URL.revokeObjectURL(url); renderImg(); save();
    } catch { toast('Could not read that image', true); }
    e.target.value = '';
  });
  $('#img-clear').addEventListener('click', () => { S.image = null; renderImg(); save(); });

  // ---------- step 2: name availability ----------
  let nameTimer = null, nameReq = 0;
  const labelInput = $('#label');
  labelInput.addEventListener('input', () => { labelInput.value = labelInput.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); S.label = labelInput.value; clearTimeout(nameTimer); nameTimer = setTimeout(checkName, 300); });
  async function checkName() {
    const label = S.label, tag = $('#name-tag'), msg = $('#name-msg'), box = $('#bigname');
    S.nameOk = false; $('#next2').disabled = true; box.className = 'bigname';
    if (!label) { tag.className = 'tag'; tag.textContent = 'Check name'; msg.textContent = 'Use 3–24 lowercase letters, numbers or hyphens. No hyphen at either end.'; return; }
    tag.className = 'tag'; tag.textContent = 'Checking'; const my = ++nameReq;
    try {
      const r = await api('/check/' + encodeURIComponent(label)); if (my !== nameReq) return;
      if (r.available) { tag.className = 'tag ok'; tag.textContent = 'Available'; msg.innerHTML = `<strong class="accent">${esc(r.name)}</strong> is free to claim.`; box.className = 'bigname ok'; S.nameOk = true; $('#next2').disabled = false; }
      else { tag.className = 'tag bad'; tag.textContent = r.valid ? 'Taken' : 'Invalid'; msg.textContent = r.reason; box.className = 'bigname bad'; }
    } catch (e) { tag.className = 'tag bad'; tag.textContent = 'Error'; msg.textContent = e.message; }
  }

  // ---------- step 3: address ----------
  function renderStep3() {
    $$('input[name=mintKind]').forEach(r => r.checked = r.value === S.mintKind);
    $('#opt-example').classList.toggle('active', S.mintKind === 'example'); $('#opt-existing').classList.toggle('active', S.mintKind === 'existing');
    $('#example-box').classList.toggle('hidden', S.mintKind !== 'example'); $('#existing-box').classList.toggle('hidden', S.mintKind !== 'existing');
    $('#example-mint').textContent = S.exampleMint; $('#mint').value = S.mint && S.mintKind === 'existing' ? S.mint : '';
  }
  $$('input[name=mintKind]').forEach(r => r.addEventListener('change', () => { S.mintKind = r.value; renderStep3(); }));
  $('#regen').addEventListener('click', () => { S.exampleMint = randomMint(); $('#example-mint').textContent = S.exampleMint; });
  $('#mint').addEventListener('input', e => { e.target.classList.remove('err'); const ok = isPubkey(e.target.value.trim()); $('#mint-help').textContent = e.target.value && ok ? 'Looks like a valid Solana address.' : 'Base58, 32 bytes. We validate the format, not that the token exists.'; $('#mint-help').className = 'help' + (e.target.value && ok ? ' ok' : ''); });

  // ---------- step 4 prefill ----------
  for (const k of ['twitter', 'telegram', 'website', 'pumpfun', 'community']) $('#l-' + k).value = S.links?.[k] || '';

  // ---------- step 5: record ----------
  const kv = (k, v, mono = true) => `<div class="kv"><span class="k">${k}</span><span class="v" ${mono ? '' : 'style="font-family:var(--body)"'}>${v}</span></div>`;
  function renderRecord() {
    const rec = { label: S.label, ticker: S.ticker, image: S.image };
    $('#rec-head').innerHTML = `${avatar(rec, 'lg')}<div><div style="font-family:var(--display);font-size:30px;font-weight:600">${nameHtml(S.label)}</div><div class="mono small muted">$${esc(S.ticker)}</div></div>`;
    const w = wallet.pubkey ? `<span class="accent">${esc(wallet.pubkey)}</span>` : '<span class="muted">Set when wallet connects</span>';
    $('#rec-locked').innerHTML = kv('Token name', esc(S.tokenName), false) + kv('Ticker', '$' + esc(S.ticker)) + kv('Token address', esc(S.mint) + (S.mintKind === 'example' ? ' <span class="badge muted">example</span>' : ''))
      + kv('Original creator', w) + kv('Created', new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) + ' (at registration)') + kv('Record owner', w) + kv('Status', '<span class="badge">Active</span>');
    const L = S.links || {};
    $('#rec-editable').innerHTML = `<div style="padding:12px 0;font-size:14px;color:var(--text-2)">${esc(S.description || 'No description.')}</div>`
      + [['twitter', 'X / Twitter'], ['telegram', 'Telegram'], ['website', 'Website'], ['pumpfun', 'Pump.fun'], ['community', 'Community']].map(([k, t]) => kv(t, L[k] ? `<a href="${esc(L[k])}" target="_blank" rel="noopener">${esc(L[k])}</a>` : '<span class="muted">Not set</span>')).join('');
  }

  // ---------- step 6: register ----------
  function renderRegister() {
    $('#preview').innerHTML = `${avatar({ label: S.label, ticker: S.ticker, image: S.image }, 'lg')}<div class="nm">${nameHtml(S.label)}</div><div class="mono small muted">$${esc(S.ticker)} · ${esc(S.tokenName)}</div><div style="margin-top:10px"><span class="badge">Available</span></div>`;
    const btn = $('#register-btn');
    if (wallet.pubkey) { $('#reg-owner').innerHTML = `<span class="accent">${esc(wallet.pubkey)}</span>`; btn.textContent = 'Sign & register'; }
    else { $('#reg-owner').textContent = 'Connect your wallet below'; btn.textContent = 'Connect wallet to register'; }
  }
  wallet.on(() => { if (S.step === 5) renderRecord(); if (S.step === 6) renderRegister(); });
  $('#register-btn').addEventListener('click', async () => {
    const btn = $('#register-btn'); err('err6', '');
    if (!wallet.pubkey) { try { await wallet.connect(); } catch (e) { err('err6', e.message || 'Connection rejected.'); } return; }
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Waiting for signature…';
    try {
      // re-check availability right before signing
      const c = await api('/check/' + encodeURIComponent(S.label));
      if (!c.available) throw new Error(c.reason || 'That name is no longer available.');
      const { nonce, signature } = await wallet.sign('register', S.label);
      btn.innerHTML = '<span class="spin"></span> Saving record…';
      const r = await api('/register', {
        name: S.label, tokenName: S.tokenName, ticker: S.ticker, description: S.description, image: S.image,
        mintKind: S.mintKind, mint: S.mint, links: S.links, wallet: wallet.pubkey, nonce, signature,
      });
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      const rec = r.record, url = `${location.origin}/n/${rec.label}`;
      $('#register-view').classList.add('hidden');
      $('#success-view').classList.remove('hidden');
      $('#success-view').innerHTML = `<div class="stepcap">Registered</div><h2>${esc(rec.name)} is yours.</h2><div class="sub">The record is live in the registry and resolves from the API right now.</div>
        <div class="preview-card">${avatar(rec, 'xl')}<div class="nm">${nameHtml(rec.label)}</div><div class="mono small muted">$${esc(rec.ticker)} · ${esc(rec.tokenName)}</div><div style="margin-top:10px"><span class="badge">Active</span></div></div>
        <div style="margin-top:14px">${kv('Owner', esc(rec.owner))}${kv('Token address', esc(rec.mint))}${kv('Identity page', `<a href="${url}">${url}</a>`)}${kv('Resolver', `<a href="/api/resolve/${esc(rec.name)}">/api/resolve/${esc(rec.name)}</a>`)}</div>
        <div class="wfoot" style="justify-content:flex-start;gap:10px;flex-wrap:wrap"><a class="btn primary" href="/n/${esc(rec.label)}">View identity page</a><button class="btn" id="copy-link">Copy link</button><a class="btn ghost" href="/names">My names</a><a class="btn ghost" href="/launch" onclick="localStorage.removeItem('nomen.draft')">Register another</a></div>`;
      $('#copy-link').addEventListener('click', () => copy(url));
      $$('.wstep').forEach(w => w.classList.add('done')); $('.wstep[data-s="6"]').classList.add('active');
      toast(`${rec.name} registered`);
    } catch (e) {
      err('err6', e.message || 'Registration failed.');
    }
    btn.disabled = false; btn.textContent = wallet.pubkey ? 'Sign & register' : 'Connect wallet to register';
  });

  show(S.label && params.get('name') ? 1 : 1);
})();
