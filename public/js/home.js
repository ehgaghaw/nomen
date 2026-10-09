(function () {
  const { $, $$, esc, api, card, toast, avatar } = Nomen;

  // availability check
  const input = $('#hero-input'), result = $('#hero-result'), btn = $('#hero-btn');
  let timer = null;
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
      } else {
        result.className = 'search-result bad'; result.textContent = r.reason;
      }
    } catch (e) { result.className = 'search-result bad'; result.textContent = e.message; }
  }
  input.addEventListener('input', () => {
    input.value = input.value.toLowerCase().replace(/[^a-z0-9-.]/g, '');
    clearTimeout(timer); timer = setTimeout(() => check(input.value), 350);
  });
  $('#hero-search').addEventListener('submit', (e) => { e.preventDefault(); check(input.value, true); });
  $$('.chip').forEach(c => c.addEventListener('click', () => { input.value = c.dataset.name; check(c.dataset.name); input.focus(); }));
  const pre = new URLSearchParams(location.search).get('q'); if (pre) { input.value = pre; check(pre); }

  // registry + strip + api sample
  (async () => {
    try {
      const { names } = await api('/names?limit=8');
      $('#home-grid').innerHTML = names.length ? names.slice(0, 8).map(card).join('') : '<div class="muted">No names yet. Be the first.</div>';
      const stripItems = names.slice(0, 10).map(r => `<a class="item" href="/n/${esc(r.label)}">${avatar(r, 'sm')}<span class="tk">$${esc(r.ticker)}</span><span class="arr">→</span><span class="nm">${esc(r.label)}<span>.mint</span></span><span class="ext">↗</span></a>`);
      $('#strip').innerHTML = stripItems.join('') + stripItems.join('');
      const milo = names.find(n => n.label === 'milo') || names[0];
      if (milo) {
        $('#api-sample').innerHTML =
`{
  <span class="k">"name"</span>: <span class="s">"${esc(milo.name)}"</span>,
  <span class="k">"ticker"</span>: <span class="s">"${esc(milo.ticker)}"</span>,
  <span class="k">"mint"</span>: <span class="s">"${esc(milo.mint)}"</span>,
  <span class="k">"owner"</span>: <span class="s">"${esc(milo.owner)}"</span>,
  <span class="k">"links"</span>: { <span class="k">"website"</span>: ${milo.links.website ? `<span class="s">"${esc(milo.links.website)}"</span>` : '<span class="n">null</span>'} },
  <span class="k">"status"</span>: <span class="s">"${esc(milo.status)}"</span>
}`;
        $('.code .path').textContent = `/api/resolve/${milo.name}`;
      }
    } catch (e) { toast('Could not load registry', true); }
  })();
})();
