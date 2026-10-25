(function () {
  'use strict';

  const M = window.Market;
  const S = window.Scalp;
  const POLL_MS = 30 * 1000; // lokalny serwer odświeża dane co 5 min; częstsze odpytywanie go nic nie kosztuje
  const STALE_MS = 7 * 60 * 1000;
  const NO_TRADING_MS = 15 * 60 * 1000;
  const TAB_KEY = 'scalping.tab';
  const SPAN_KEY = 'scalping.span';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    return node;
  }

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* bez zapisu */ } },
  };

  const view = { data: null, offline: false, decimals: 1, span: Number(store.get(SPAN_KEY)) || 72, hover: null };

  // ---------- formatowanie ----------

  function num(x, d = view.decimals) {
    if (!Number.isFinite(x)) return '—';
    return x.toLocaleString('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d }).replace('-', '−');
  }
  const signed = (x, d) => (x > 0 ? '+' : '') + num(x, d);
  const tone = (x) => (x > 0 ? 'tone-good' : x < 0 ? 'tone-bad' : 'tone-neutral');
  const hm = (ms) => new Date(ms).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  const hms = (ms) => new Date(ms).toLocaleTimeString('pl-PL');
  const pct = (x, base) => (Number.isFinite(x) && base ? `${signed((x / base) * 100, 2)}%` : '');

  function decimalsIn(candles) {
    let d = 0;
    for (const c of candles.slice(-50)) for (const v of [...c.bid, ...c.ask]) d = Math.max(d, S.decimalsOf(Math.round(v * 1e5) / 1e5));
    return Math.min(Math.max(d, 1), 5);
  }

  // ---------- zakładki ----------

  function showTab(tab) {
    for (const b of $$('[data-tab]')) {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      $(`#tab-${b.dataset.tab}`).hidden = !on;
    }
    store.set(TAB_KEY, tab);
    if (tab === 'market') renderChart();
  }

  // ---------- stan połączenia ----------

  function status() {
    const d = view.data;
    const now = Date.now();
    if (view.offline || !d) return { key: 'off', label: 'Brak połączenia' };
    if (d.lastError) return { key: 'err', label: 'Błąd pobierania' };
    if (!d.updatedAt || now - Date.parse(d.updatedAt) > STALE_MS) return { key: 'stale', label: 'Dane nieaktualne' };
    const last = d.candles[d.candles.length - 1];
    if (!last || now - last.t > NO_TRADING_MS) return { key: 'idle', label: 'Brak notowań' };
    return { key: 'live', label: 'Na żywo' };
  }

  function message(kind, nodes) {
    const host = $('#market-messages');
    host.replaceChildren();
    if (nodes) host.append(el('div', { class: `msg msg-${kind}` }, ...nodes));
  }

  function offlineHelp() {
    const local = location.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
    return [
      el('strong', { text: local ? 'Serwer pośredniczący nie odpowiada.' : 'Notowania wymagają lokalnego serwera pośredniczącego.' }),
      el('ol', null,
        el('li', null, 'Skopiuj ', el('code', { text: 'scalping/server/.env.przyklad' }), ' jako ', el('code', { text: '.env' }), ' i wpisz klucz API Capital.com, login i hasło klucza.'),
        el('li', null, 'Uruchom ', el('code', { text: 'node scalping/server/capital-proxy.js' }), ' (Node.js 18+).'),
        el('li', null, 'Otwórz ', el('code', { text: 'http://127.0.0.1:8787' }), ' — aplikacja z notowaniami odświeżanymi co 5 minut.')),
    ];
  }

  // ---------- render ----------

  function render() {
    const st = status();
    const pill = $('#market-status');
    pill.className = `pill pill-${st.key}`;
    pill.textContent = st.label;
    $('#market-dot').className = `dot dot-${st.key}`;
    $('#market-dot').title = st.label;

    const d = view.data;
    const candles = d ? d.candles : [];
    $('#market-title').textContent = `${d && d.epic ? d.epic : 'USTECH100'} · świece 5 min${d && d.demo ? ' · demo' : ''}`;
    const meta = [];
    if (d && d.updatedAt) meta.push(`aktualizacja ${hms(Date.parse(d.updatedAt))}`);
    if (d && d.nextFetchAt) meta.push(`następna ok. ${hm(Date.parse(d.nextFetchAt))}`);
    if (candles.length) meta.push(`${candles.length} świec w pamięci`);
    $('#market-meta').textContent = meta.join(' · ');

    if (st.key === 'off') message('warn', offlineHelp());
    else if (st.key === 'err') message('error', [el('strong', { text: 'Ostatnie pobranie nie powiodło się: ' }), d.lastError, el('br'), 'Pokazane są ostatnie zapisane dane.']);
    else if (st.key === 'stale') message('warn', ['Serwer od ponad 7 minut nie pobrał nowych danych — sprawdź okno, w którym działa skrypt.']);
    else if (st.key === 'idle') message('warn', [`Ostatnia świeca z ${new Date(candles[candles.length - 1].t).toLocaleString('pl-PL')} — rynek może być zamknięty.`]);
    else message();

    view.decimals = candles.length ? decimalsIn(candles) : 1;
    const sum = M.summarize(candles, Date.now());
    const tile = (label, value, sub, cls) => el('div', { class: 'tile' },
      el('span', { class: 'kv-label', text: label }),
      el('span', { class: `tile-value ${cls || ''}`, text: value }),
      sub ? el('span', { class: 'kv-sub', text: sub }) : null);
    $('#market-tiles').replaceChildren(...(sum ? [
      tile('Bid', num(sum.bid), `świeca ${hm(sum.time)}${sum.complete ? '' : ' (w trakcie)'}`),
      tile('Ask', num(sum.ask)),
      tile('Spread', num(sum.spread), 'pkt'),
      tile('Zmiana 5 min', signed(sum.changePrev), pct(sum.changePrev, sum.bid - sum.changePrev), tone(sum.changePrev)),
      tile('Od otwarcia dnia', signed(sum.changeDay), pct(sum.changeDay, sum.dayOpen), tone(sum.changeDay)),
      tile('Zakres dnia', `${num(sum.dayLow)} – ${num(sum.dayHigh)}`, `${num(sum.dayHigh - sum.dayLow)} pkt`),
      tile('Śr. zakres świecy', num(sum.avgRange), 'ostatnia godzina, pkt'),
    ] : [el('p', { class: 'muted', text: 'Brak danych do pokazania.' })]));
    $('#use-long').disabled = !sum;
    $('#use-short').disabled = !sum;

    renderTable(candles);
    renderChart();
  }

  function renderTable(candles) {
    const body = $('#candles');
    body.replaceChildren();
    const rows = candles.slice(-12).reverse();
    if (!rows.length) {
      body.append(el('tr', null, el('td', { class: 'empty', colspan: '8', text: 'Brak świec.' })));
      return;
    }
    const now = Date.now();
    rows.forEach((c, i) => {
      const prev = candles[candles.length - 2 - i];
      const ch = prev ? c.bid[3] - prev.bid[3] : NaN;
      body.append(el('tr', M.isComplete(c, now) ? null : { class: 'is-live' },
        el('td', { text: hm(c.t) + (M.isComplete(c, now) ? '' : ' •') }),
        ...c.bid.map((v) => el('td', { class: 'num', text: num(v) })),
        el('td', { class: `num ${tone(ch)}`, text: signed(ch) }),
        el('td', { class: 'num', text: num(c.bid[1] - c.bid[2]) }),
        el('td', { class: 'num', text: num(c.ask[3] - c.bid[3]) })));
    });
  }

  // ---------- wykres świecowy ----------

  function niceTicks(lo, hi, count) {
    const raw = (hi - lo) / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    const ticks = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(v);
    return { ticks, step };
  }

  function renderChart() {
    const host = $('#chart');
    if (!host || $('#tab-market').hidden) return;
    host.replaceChildren();
    const all = view.data ? view.data.candles : [];
    const candles = all.slice(-view.span);
    $$('[data-span]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.span) === view.span)));
    if (!candles.length) {
      host.append(el('p', { class: 'muted chart-empty', text: 'Wykres pojawi się po pobraniu pierwszych świec.' }));
      return;
    }

    const W = Math.max(280, host.clientWidth);
    const H = W < 500 ? 240 : 320;
    const pad = { l: 8, r: 64, t: 12, b: 26 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    let lo = Math.min(...candles.map((c) => c.bid[2]));
    let hi = Math.max(...candles.map((c) => c.bid[1]));
    if (hi === lo) { hi += 1; lo -= 1; }
    const margin = (hi - lo) * 0.06;
    lo -= margin; hi += margin;
    const y = (v) => pad.t + ((hi - v) / (hi - lo)) * ih;
    const band = iw / view.span; // stała szerokość świecy niezależnie od liczby danych
    const x0 = pad.l + iw - candles.length * band;
    const cx = (i) => x0 + band * (i + 0.5);
    const bodyW = Math.max(1, Math.min(12, band * 0.65));
    const now = Date.now();

    const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'candles-svg' });

    const { ticks } = niceTicks(lo, hi, H < 300 ? 4 : 6);
    const tickDec = Math.max(0, Math.min(view.decimals, -Math.floor(Math.log10(Math.max(1e-9, ticks[1] - ticks[0] || 1)))));
    for (const v of ticks) {
      root.append(svg('line', { x1: pad.l, x2: pad.l + iw, y1: y(v), y2: y(v), class: 'grid' }));
      const t = svg('text', { x: pad.l + iw + 6, y: y(v) + 4, class: 'tick' });
      t.textContent = num(v, tickDec);
      root.append(t);
    }
    // etykiety czasu co pełną godzinę (gęściej, gdy zakres jest krótki)
    const every = view.span <= 36 ? 30 : view.span <= 72 ? 60 : view.span <= 144 ? 120 : 240;
    candles.forEach((c, i) => {
      const d = new Date(c.t);
      if ((d.getHours() * 60 + d.getMinutes()) % every !== 0) return;
      root.append(svg('line', { x1: cx(i), x2: cx(i), y1: pad.t, y2: pad.t + ih, class: 'grid grid-v' }));
      const t = svg('text', { x: cx(i), y: H - 8, class: 'tick', 'text-anchor': 'middle' });
      t.textContent = hm(c.t);
      root.append(t);
    });
    root.append(svg('line', { x1: pad.l, x2: pad.l + iw, y1: pad.t + ih, y2: pad.t + ih, class: 'axis' }));

    candles.forEach((c, i) => {
      const [o, h, l, cl] = c.bid;
      const up = cl >= o;
      const live = !M.isComplete(c, now);
      const g = svg('g', { class: `candle ${up ? 'up' : 'down'}${live ? ' live' : ''}` });
      g.append(svg('line', { x1: cx(i), x2: cx(i), y1: y(h), y2: y(l), class: 'wick' }));
      const top = y(Math.max(o, cl));
      g.append(svg('rect', { x: cx(i) - bodyW / 2, y: top, width: bodyW, height: Math.max(1, y(Math.min(o, cl)) - top), class: 'body' }));
      root.append(g);
    });

    // linia ostatniej ceny z etykietą przy osi
    const last = candles[candles.length - 1];
    const ly = y(last.bid[3]);
    root.append(svg('line', { x1: pad.l, x2: pad.l + iw, y1: ly, y2: ly, class: 'last-line' }));
    const tagG = svg('g', { class: 'last-tag' });
    tagG.append(svg('rect', { x: pad.l + iw + 2, y: ly - 9, width: pad.r - 4, height: 18, rx: 4 }));
    const tagT = svg('text', { x: pad.l + iw + 6, y: ly + 4 });
    tagT.textContent = num(last.bid[3]);
    tagG.append(tagT);
    root.append(tagG);

    // warstwa najechania: pionowy celownik + podpowiedź
    const cross = svg('line', { y1: pad.t, y2: pad.t + ih, class: 'crosshair', visibility: 'hidden' });
    root.append(cross);
    const hit = svg('rect', { x: pad.l, y: pad.t, width: iw, height: ih, class: 'hit', tabindex: '0', 'aria-label': 'Najedź lub użyj strzałek, aby zobaczyć świece' });
    root.append(hit);
    host.append(root);

    const tip = $('#chart-tip');
    const show = (i, clientX, clientY) => {
      if (i < 0 || i >= candles.length) { hide(); return; }
      view.hover = i;
      const c = candles[i];
      cross.setAttribute('x1', cx(i));
      cross.setAttribute('x2', cx(i));
      cross.setAttribute('visibility', 'visible');
      const prev = candles[i - 1] || all[all.length - candles.length - 1];
      const ch = prev ? c.bid[3] - prev.bid[3] : NaN;
      tip.replaceChildren(
        el('div', { class: 'tip-head' }, el('span', { text: `${hm(c.t)}–${hm(c.t + M.FIVE_MIN)}` }), M.isComplete(c, now) ? null : el('span', { class: 'muted', text: 'w trakcie' })),
        ...[['Otwarcie', c.bid[0]], ['Maks.', c.bid[1]], ['Min.', c.bid[2]], ['Zamknięcie', c.bid[3]]]
          .map(([k, v]) => el('div', { class: 'tip-row' }, el('span', { class: 'muted', text: k }), el('strong', { text: num(v) }))),
        el('div', { class: 'tip-row' }, el('span', { class: 'muted', text: 'Zmiana' }), el('strong', { class: tone(ch), text: signed(ch) })),
        el('div', { class: 'tip-row' }, el('span', { class: 'muted', text: 'Spread' }), el('strong', { text: num(c.ask[3] - c.bid[3]) })));
      tip.hidden = false;
      const r = host.getBoundingClientRect();
      const px = clientX != null ? clientX : r.left + cx(i);
      const py = clientY != null ? clientY : r.top + pad.t + 10;
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.min(window.innerWidth - tw - 8, Math.max(8, px + 14 + tw > window.innerWidth ? px - tw - 14 : px + 14))}px`;
      tip.style.top = `${Math.max(8, py - 10)}px`;
    };
    const hide = () => { view.hover = null; cross.setAttribute('visibility', 'hidden'); tip.hidden = true; };
    const indexAt = (clientX) => Math.floor((clientX - root.getBoundingClientRect().left - x0) / band);
    hit.addEventListener('pointermove', (e) => show(indexAt(e.clientX), e.clientX, e.clientY));
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('blur', hide);
    hit.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const cur = view.hover == null ? candles.length - 1 : view.hover + (e.key === 'ArrowLeft' ? -1 : 1);
      show(Math.max(0, Math.min(candles.length - 1, cur)));
    });
  }

  // ---------- dane ----------

  async function poll() {
    if (!location.protocol.startsWith('http')) { view.offline = true; render(); return; }
    try {
      const res = await fetch('api/rynek', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.candles)) throw new Error('nieoczekiwany format');
      view.data = data;
      view.offline = false;
    } catch (e) {
      view.offline = true;
    }
    render();
  }

  function init() {
    $$('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    $('.tabs').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const tabs = $$('[data-tab]');
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      showTab(next.dataset.tab);
    });
    $$('[data-span]').forEach((b) => b.addEventListener('click', () => {
      view.span = Number(b.dataset.span);
      store.set(SPAN_KEY, String(view.span));
      renderChart();
    }));
    const use = (side) => {
      const sum = M.summarize(view.data ? view.data.candles : [], Date.now());
      if (!sum) return;
      showTab('calc');
      window.ScalpApp.useEntry(side, side === 'long' ? sum.ask : sum.bid);
    };
    $('#use-long').addEventListener('click', () => use('long'));
    $('#use-short').addEventListener('click', () => use('short'));
    let resizeTimer;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderChart, 150); });

    showTab(store.get(TAB_KEY) === 'market' ? 'market' : 'calc');
    poll();
    setInterval(poll, POLL_MS);
  }

  init();
})();
