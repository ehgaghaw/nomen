(function () {
  const { $, $$, esc, api, card, avatar, logoSrc, short, reveal, onReveal, REDUCED } = Nomen;

  // ---------- availability check ----------
  const input = $('#hero-input'), result = $('#hero-result');
  let timer = null, typed = false;
  async function check(label, go) {
    label = (label || '').trim().toLowerCase().replace(/\.mint$/, '');
    if (!label) { result.textContent = ''; result.className = 'search-result'; return; }
    result.className = 'search-result'; result.textContent = 'Checking…';
    try {
      const r = await api('/check/' + encodeURIComponent(label));
      if (r.available) {
        result.className = 'search-result ok';
        result.innerHTML = `<strong>${esc(r.name)}</strong> is available. <a href="/launch?name=${encodeURIComponent(label)}" style="text-decoration:underline">Claim it →</a>`;
        if (go) location.href = `/launch?name=${encodeURIComponent(label)}`;
      } else if (r.valid) {
        result.className = 'search-result';
        result.innerHTML = `<strong>${esc(r.name)}</strong> is taken. <a href="/n/${esc(label)}" style="color:var(--accent);text-decoration:underline">View the record →</a>`;
        if (go) location.href = `/n/${label}`;
      } else { result.className = 'search-result bad'; result.textContent = r.reason; }
    } catch (e) { result.className = 'search-result bad'; result.textContent = e.message; }
  }
  input.addEventListener('input', () => {
    typed = true;
    input.value = input.value.toLowerCase().replace(/[^a-z0-9-.]/g, '');
    clearTimeout(timer); timer = setTimeout(() => check(input.value), 350);
  });
  input.addEventListener('focus', () => { typed = true; input.placeholder = 'Find your name'; });
  $('#hero-search').addEventListener('submit', (e) => { e.preventDefault(); check(input.value, true); });
  $$('.chip').forEach(c => c.addEventListener('click', () => { typed = true; input.value = c.dataset.name; check(c.dataset.name); input.focus(); }));
  const pre = new URLSearchParams(location.search).get('q'); if (pre) { typed = true; input.value = pre; check(pre); }

  // ---------- typewriter placeholder ----------
  if (!REDUCED) (async () => {
    const words = ['milo', 'agent', 'your-token', 'moon', 'cat', 'nova'];
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    await wait(1600);
    for (let i = 0; !typed; i++) {
      const w = words[i % words.length];
      for (let k = 1; k <= w.length && !typed; k++) { input.placeholder = w.slice(0, k); await wait(90); }
      await wait(1300);
      for (let k = w.length; k >= 0 && !typed; k--) { input.placeholder = w.slice(0, k) || 'Find your name'; await wait(45); }
      await wait(500);
    }
    input.placeholder = 'Find your name';
  })();

  // ---------- floating logos in the hero ----------
  const FLOAT = [
    { src: '/img/tokens/milo.svg', x: '7%', y: '20%', r: -10, d: .9, dur: 7, depth: 18 },
    { src: '/img/tokens/agent.svg', x: '14%', y: '62%', r: 8, d: 1.1, dur: 8, depth: 30 },
    { src: '/img/tokens/pixel.svg', x: '4%', y: '82%', r: -4, d: 1.4, dur: 6.5, depth: 12 },
    { src: '/img/tokens/cat.svg', x: '86%', y: '56%', r: 10, d: 1.0, dur: 7.5, depth: 26 },
    { src: '/img/tokens/nova.svg', x: '78%', y: '82%', r: -8, d: 1.3, dur: 6, depth: 16 },
    { src: '/img/tokens/orbit.svg', x: '92%', y: '76%', r: 6, d: 1.6, dur: 8.5, depth: 22 },
  ];
  const fl = $('#floaters');
  fl.innerHTML = FLOAT.map(f => `<div class="floater-wrap" data-depth="${f.depth}" style="left:${f.x};top:${f.y}">
    <div class="floater" style="--r:${f.r}deg;--d:${f.d}s;--dur:${f.dur}s"><img src="${f.src}" alt=""></div></div>`).join('');
  if (!REDUCED) {
    const hero = $('#hero'); let raf = null;
    hero.addEventListener('mousemove', (e) => {
      const b = hero.getBoundingClientRect();
      const mx = (e.clientX - b.left) / b.width - .5, my = (e.clientY - b.top) / b.height - .5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => $$('.floater-wrap', fl).forEach(w => {
        const d = +w.dataset.depth; w.style.transform = `translate(${-mx * d}px, ${-my * d}px)`;
      }));
    });
  }

  // ---------- registry, strip, before/after, api sample ----------
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function scramble(el, finalText, ms = 700) {
    if (REDUCED) { el.textContent = finalText; return; }
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / ms), n = Math.floor(p * finalText.length);
      el.textContent = finalText.slice(0, n) + Array.from(finalText.slice(n), c => c === '…' ? c : B58[(Math.random() * 58) | 0]).join('');
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function stripItem(r) {
    return `<a class="item" href="/n/${esc(r.label)}">${avatar(r, 'sm')}<span class="tk">$${esc(r.ticker)}</span><span class="arr">→</span><span class="nm">${esc(r.label)}<span>.mint</span></span><span class="ext">↗</span></a>`;
  }
  function jsonLines(rec) {
    const v = (x) => x == null ? '<span class="n">null</span>' : `<span class="s">"${esc(x)}"</span>`;
    const lines = ['{',
      `  <span class="k">"name"</span>: ${v(rec.name)},`,
      `  <span class="k">"ticker"</span>: ${v(rec.ticker)},`,
      `  <span class="k">"mint"</span>: ${v(rec.mint)},`,
      `  <span class="k">"creator"</span>: ${v(rec.creator)},`,
      `  <span class="k">"website"</span>: ${v(rec.links.website)},`,
      `  <span class="k">"status"</span>: ${v(rec.status)}`,
      '}'];
    return lines.map((l, i) => `<span class="ln" style="--i:${i}">${l}</span>`).join('');
  }

  (async () => {
    let names = [];
    try { names = (await api('/names?limit=12')).names; } catch { $('#home-grid').innerHTML = '<div class="muted">Could not load the registry.</div>'; return; }
    const grid = $('#home-grid');
    grid.innerHTML = names.length ? '' : '<div class="muted">No names yet. Be the first.</div>';
    // cards appear as the grid scrolls into view
    grid.setAttribute('data-reveal', '');
    reveal(grid);
    onReveal(grid, () => { grid.innerHTML = names.slice(0, 8).map(card).join(''); });

    // three rotating strip slots
    const cells = $$('#strip .cell');
    const pool = names.length ? names : [];
    let cursor = 0;
    cells.forEach((c, i) => { if (pool[i]) { c.innerHTML = stripItem(pool[i]); c.firstElementChild.classList.add('enter'); c.firstElementChild.style.animationDelay = (0.9 + i * 0.12) + 's'; } });
    cursor = Math.min(3, pool.length);
    if (!REDUCED && pool.length > 3) {
      let slot = 0;
      setInterval(() => {
        const c = cells[slot % 3]; slot++;
        const old = c.firstElementChild; const r = pool[cursor++ % pool.length];
        if (old) { old.classList.remove('enter'); old.style.animationDelay = '0s'; old.classList.add('leave'); setTimeout(() => old.remove(), 700); }
        c.insertAdjacentHTML('beforeend', stripItem(r)); c.lastElementChild.classList.add('enter');
      }, 2200);
    }

    // before / after cycler
    const featured = names.filter(n => n.image).slice(0, 6);
    if (featured.length) {
      let k = 0;
      const show = () => {
        const r = featured[k++ % featured.length];
        scramble($('#ba-addr'), short(r.mint, 9));
        const nm = $('#ba-name');
        nm.classList.remove('flip'); void nm.offsetWidth; nm.classList.add('flip');
        nm.innerHTML = `<span class="lg"><img src="${esc(logoSrc(r))}" alt=""></span><span>${esc(r.label)}<span class="sfx">.mint</span></span>`;
      };
      const stack = $('#stack');
      onReveal(stack, () => { show(); if (!REDUCED) setInterval(show, 3600); });
    }

    // api sample, typed in line by line when visible
    const milo = names.find(n => n.label === 'milo') || names[0];
    if (milo) { $('#api-sample').innerHTML = jsonLines(milo); $('#api-path').textContent = `/api/resolve/${milo.name}`; }
    reveal($('#api-sample').parentElement.parentElement);

    // logos orbiting the CTA
    const spots = [['6%', '18%'], ['12%', '64%'], ['86%', '22%'], ['90%', '62%'], ['22%', '38%'], ['76%', '42%']];
    $('#cta-logos').innerHTML = names.slice(0, 6).map((r, i) => `<img src="${esc(logoSrc(r))}" alt="" style="left:${spots[i][0]};top:${spots[i][1]};animation-delay:${i * .5}s;--r:${(i % 2 ? 8 : -8)}deg">`).join('');
  })();
})();
