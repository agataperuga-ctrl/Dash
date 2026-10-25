(function () {
  'use strict';

  const { detect, quarterLabel } = window.Anomalies;
  const { parseCsv } = window.KpiData;

  const SEVERITY_LABEL = { anomalia: 'Anomalia', obserwacja: 'Do obserwacji', norma: 'W normie', brak: 'Brak oceny' };
  const SEVERITY_ICON = { anomalia: '!', obserwacja: '?', norma: '✓', brak: '–' };

  const state = {
    data: null,
    results: [],
    quarter: null,
    sensitivity: 'standardowa',
    source: 'Przykładowe dane',
  };

  const $ = (sel) => document.querySelector(sel);

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
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

  // ---------- formatowanie ----------

  function fmt(value, kpi, extraDecimals = 0) {
    if (!Number.isFinite(value)) return '—';
    const d = kpi.decimals + extraDecimals;
    return value.toLocaleString('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d }).replace('-', '−');
  }

  function withUnit(text, kpi) {
    if (text === '—' || !kpi.unit) return text;
    return kpi.unit === '%' ? text + '%' : text + ' ' + kpi.unit;
  }

  function signed(text, value) {
    return value > 0 ? '+' + text : text.replace('-', '−');
  }

  function pct(value) {
    if (!Number.isFinite(value)) return '—';
    return signed(Math.abs(value) < 0.0005 ? '0,0%' : (value * 100).toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%', value);
  }

  // Zmiana między okresami: dla wskaźników w % różnica w p.p., dla pozostałych zmiana względna
  // (bezwzględna, gdy szereg przyjmuje wartości ≤ 0 — wtedy procent nie ma sensu).
  function change(r, current, previous) {
    const { kpi } = r;
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return { text: '—', diff: NaN };
    const diff = current - previous;
    if (kpi.unit === '%') {
      return { text: signed(fmt(diff, kpi) + ' p.p.', diff), diff };
    }
    if (r.model !== 'mult') return { text: signed(fmt(diff, kpi), diff), diff };
    return { text: pct(diff / previous), diff };
  }

  // Czy odchylenie w górę jest dobre? 'good' | 'bad' | 'neutral'
  function tone(kpi, diff) {
    if (!Number.isFinite(diff) || diff === 0 || !kpi.direction) return 'neutral';
    return (diff > 0) === (kpi.direction === 'up') ? 'good' : 'bad';
  }

  function deviation(r, p) {
    const { kpi } = r;
    if (!Number.isFinite(p.expected)) return { text: '—', diff: NaN };
    const diff = p.value - p.expected;
    if (r.model === 'mult' && kpi.unit !== '%') return { text: pct(diff / p.expected), diff };
    return { text: signed(fmt(diff, kpi) + (kpi.unit === '%' ? ' p.p.' : ''), diff), diff };
  }

  // ---------- model ----------

  function load(text, source) {
    const data = parseCsv(text);
    const msg = $('#messages');
    msg.replaceChildren();
    if (!data.kpis.length) {
      msg.append(el('p', { class: 'msg msg-error', text: 'Nie udało się wczytać danych. ' + data.errors.join(' ') }));
      return;
    }
    if (data.errors.length) {
      const details = el('details', { class: 'msg msg-warn' },
        el('summary', { text: `Pominięto lub poprawiono ${data.errors.length} ${plural(data.errors.length, 'wiersz', 'wiersze', 'wierszy')} — szczegóły` }));
      const list = el('ul');
      data.errors.slice(0, 50).forEach((e) => list.append(el('li', { text: e })));
      details.append(list);
      msg.append(details);
    }
    state.data = data;
    state.source = source;
    state.quarter = data.end;
    analyse();
    renderControls();
    render();
  }

  function analyse() {
    const { data } = state;
    state.results = data.kpis.map((kpi) => ({ kpi, ...detect(kpi.values, data.start, { sensitivity: state.sensitivity }) }));
  }

  function pointAt(result, q) {
    return result.points[q - state.data.start];
  }

  // ---------- render ----------

  function renderControls() {
    const sel = $('#quarter');
    sel.replaceChildren();
    for (let q = state.data.end; q >= state.data.start; q--) {
      sel.append(el('option', { value: String(q), text: quarterLabel(q) }));
    }
    sel.value = String(state.quarter);
    $('#source').textContent = state.source;
  }

  function render() {
    renderSummary();
    renderTiles();
    renderAnomalyTable();
    renderCharts();
    renderDataTable();
  }

  function renderSummary() {
    const q = state.quarter;
    let anomalies = 0;
    let watch = 0;
    for (const r of state.results) {
      const p = pointAt(r, q);
      if (p.severity === 'anomalia') anomalies++;
      if (p.severity === 'obserwacja') watch++;
    }
    const box = $('#summary');
    box.replaceChildren(
      el('h2', { text: 'Wyniki za ' + quarterLabel(q) }),
      el('p', { class: 'summary-line' },
        chip(anomalies ? 'anomalia' : 'norma', anomalies ? `${anomalies} ${plural(anomalies, 'anomalia', 'anomalie', 'anomalii')}` : 'Brak anomalii'),
        watch ? chip('obserwacja', `${watch} do obserwacji`) : null,
        el('span', { class: 'muted', text: `${state.results.length} ${plural(state.results.length, 'wskaźnik', 'wskaźniki', 'wskaźników')} · czułość: ${state.sensitivity}` })),
    );
  }

  function plural(n, one, few, many) {
    if (n === 1) return one;
    const d = n % 10;
    const dd = n % 100;
    return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
  }

  function chip(severity, label) {
    return el('span', { class: 'chip chip-' + severity },
      el('span', { class: 'chip-icon', 'aria-hidden': 'true', text: SEVERITY_ICON[severity] }),
      el('span', { text: label || SEVERITY_LABEL[severity] }));
  }

  function delta(label, ch, kpi) {
    const t = tone(kpi, ch.diff);
    const arrow = !Number.isFinite(ch.diff) || ch.diff === 0 ? '' : ch.diff > 0 ? '▲ ' : '▼ ';
    return el('div', { class: 'delta' },
      el('span', { class: 'delta-label', text: label }),
      el('span', { class: 'delta-value tone-' + t, text: arrow + ch.text }));
  }

  function renderTiles() {
    const grid = $('#tiles');
    grid.replaceChildren();
    const q = state.quarter;
    for (const r of state.results) {
      const { kpi } = r;
      const p = pointAt(r, q);
      const prev = q - 1 >= state.data.start ? pointAt(r, q - 1).value : NaN;
      const yoy = q - 4 >= state.data.start ? pointAt(r, q - 4).value : NaN;
      const dev = deviation(r, p);

      const tile = el('article', { class: 'tile tile-' + p.severity },
        el('header', { class: 'tile-head' },
          el('h3', { text: kpi.name }),
          p.severity === 'anomalia' || p.severity === 'obserwacja' ? chip(p.severity) : null),
        el('div', { class: 'tile-value', text: withUnit(fmt(p.value, kpi), kpi) }),
        el('div', { class: 'deltas' },
          delta('kw/kw', change(r, p.value, prev), kpi),
          delta('r/r', change(r, p.value, yoy), kpi)),
        el('p', { class: 'tile-expected' },
          Number.isFinite(p.expected)
            ? `Oczekiwano ${withUnit(fmt(p.expected, kpi), kpi)} · odchylenie ${dev.text}`
            : r.enough ? 'Brak oceny dla tego kwartału' : 'Za mało danych do wykrywania anomalii (min. 8 kwartałów)'));
      grid.append(tile);
    }
  }

  function renderAnomalyTable() {
    const tbody = $('#anomalies tbody');
    tbody.replaceChildren();
    const onlySelected = $('#only-selected').checked;
    const rows = [];
    for (const r of state.results) {
      for (const p of r.points) {
        if (p.severity !== 'anomalia' && p.severity !== 'obserwacja') continue;
        if (onlySelected && p.index !== state.quarter) continue;
        rows.push({ r, p });
      }
    }
    rows.sort((a, b) => b.p.index - a.p.index || Math.abs(b.p.z) - Math.abs(a.p.z));

    $('#anomaly-count').textContent = rows.length
      ? `${rows.length} ${plural(rows.length, 'pozycja', 'pozycje', 'pozycji')}`
      : '';
    if (!rows.length) {
      tbody.append(el('tr', {}, el('td', { colspan: '8', class: 'empty', text: onlySelected
        ? 'Brak anomalii w wybranym kwartale.' : 'Nie wykryto anomalii.' })));
      return;
    }
    for (const { r, p } of rows) {
      const { kpi } = r;
      const dev = deviation(r, p);
      const t = tone(kpi, dev.diff);
      const assessment = t === 'good' ? 'korzystna' : t === 'bad' ? 'niekorzystna' : 'neutralna';
      const tr = el('tr', {
        class: p.index === state.quarter ? 'is-selected' : '',
        tabindex: '0',
        title: 'Pokaż ten kwartał',
        onclick: () => selectQuarter(p.index),
        onkeydown: (e) => { if (e.key === 'Enter') selectQuarter(p.index); },
      },
      el('td', {}, chip(p.severity)),
      el('td', { text: quarterLabel(p.index) }),
      el('td', { text: kpi.name }),
      el('td', { class: 'num', text: withUnit(fmt(p.value, kpi), kpi) }),
      el('td', { class: 'num', text: withUnit(fmt(p.expected, kpi), kpi) }),
      el('td', { class: 'num tone-' + t, text: dev.text }),
      el('td', { class: 'num', text: p.z.toLocaleString('pl-PL', { maximumFractionDigits: 1, minimumFractionDigits: 1 }).replace('-', '−') }),
      el('td', { class: 'tone-' + t, text: assessment }));
      tbody.append(tr);
    }
  }

  function selectQuarter(q) {
    state.quarter = q;
    $('#quarter').value = String(q);
    render();
  }

  // ---------- wykresy ----------

  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
    return { lo, hi, ticks, step };
  }

  function pathFrom(points) {
    // points: [x, y] lub null (przerwa w danych)
    let d = '';
    let pen = false;
    for (const p of points) {
      if (!p) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1);
      pen = true;
    }
    return d;
  }

  function bandPaths(xs, lower, upper) {
    const paths = [];
    let seg = [];
    const flush = () => {
      if (seg.length > 1) {
        const top = seg.map((i) => [xs[i], upper[i]]);
        const bottom = seg.slice().reverse().map((i) => [xs[i], lower[i]]);
        paths.push(pathFrom(top) + pathFrom(bottom).replace(/^M/, 'L') + 'Z');
      }
      seg = [];
    };
    for (let i = 0; i < xs.length; i++) {
      if (Number.isFinite(lower[i]) && Number.isFinite(upper[i])) seg.push(i);
      else flush();
    }
    flush();
    return paths;
  }

  function renderCharts() {
    const grid = $('#charts');
    grid.replaceChildren();
    for (const r of state.results) {
      const card = el('figure', { class: 'chart-card' },
        el('figcaption', {},
          el('span', { class: 'chart-title', text: r.kpi.name }),
          el('span', { class: 'muted', text: [r.kpi.unit, r.kpi.direction === 'up' ? 'więcej = lepiej' : r.kpi.direction === 'down' ? 'mniej = lepiej' : ''].filter(Boolean).join(' · ') })));
      const host = el('div', { class: 'chart-host' });
      card.append(host);
      grid.append(card);
      drawChart(host, r);
    }
  }

  function drawChart(host, r) {
    const { kpi, points } = r;
    const width = Math.max(260, host.clientWidth);
    const height = 200;
    const m = { top: 12, right: 12, bottom: 26, left: 52 };
    const iw = width - m.left - m.right;
    const ih = height - m.top - m.bottom;
    const n = points.length;

    const all = points.flatMap((p) => [p.value, p.lower, p.upper]).filter(Number.isFinite);
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    // Pasmo normy może sięgać daleko przy dużym rozrzucie — nie pozwól mu spłaszczyć danych.
    const vals = points.map((p) => p.value).filter(Number.isFinite);
    const vLo = Math.min(...vals);
    const vHi = Math.max(...vals);
    const pad = (vHi - vLo || Math.abs(vHi) || 1) * 0.5;
    lo = Math.max(lo, vLo - pad);
    hi = Math.min(hi, vHi + pad);
    const { lo: yLo, hi: yHi, ticks } = niceTicks(lo, hi, 4);

    const x = (i) => m.left + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v) => m.top + ih - ((Math.min(Math.max(v, yLo), yHi) - yLo) / (yHi - yLo)) * ih;
    const xs = points.map((_, i) => x(i));

    const root = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img',
      'aria-label': `${kpi.name}: wykres wartości kwartalnych z zakresem normy i zaznaczonymi anomaliami` });
    const defs = svg('defs');
    const clipId = 'clip-' + Math.random().toString(36).slice(2);
    const clip = svg('clipPath', { id: clipId });
    clip.append(svg('rect', { x: m.left, y: m.top, width: iw, height: ih }));
    defs.append(clip);
    root.append(defs);

    // siatka i oś Y
    for (const t of ticks) {
      root.append(svg('line', { x1: m.left, x2: m.left + iw, y1: y(t), y2: y(t), class: t === yLo ? 'axis' : 'grid' }));
      const label = svg('text', { x: m.left - 8, y: y(t), class: 'tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' });
      label.textContent = t.toLocaleString('pl-PL', { maximumFractionDigits: 3 });
      root.append(label);
    }
    // oś X — etykiety lat przy Q1 (lub na początku), znaczniki kwartałów
    const yearEvery = Math.ceil((n / 4) / Math.max(1, Math.floor(iw / 48)));
    points.forEach((p, i) => {
      const isQ1 = p.index % 4 === 0;
      root.append(svg('line', { x1: xs[i], x2: xs[i], y1: m.top + ih, y2: m.top + ih + (isQ1 ? 5 : 3), class: 'axis' }));
      const year = Math.floor(p.index / 4);
      if (isQ1 && year % yearEvery === 0) {
        const label = svg('text', { x: xs[i], y: m.top + ih + 17, class: 'tick', 'text-anchor': i === 0 ? 'start' : 'middle' });
        label.textContent = String(year);
        root.append(label);
      }
    });

    // wybrany kwartał
    const sel = state.quarter - state.data.start;
    const step = n > 1 ? iw / (n - 1) : iw;
    const plot = svg('g', { 'clip-path': `url(#${clipId})` });
    root.append(plot);
    plot.append(svg('rect', { x: xs[sel] - step / 2, y: m.top, width: step, height: ih, class: 'selected-band' }));
    for (const d of bandPaths(xs, points.map((p) => y(p.lower)), points.map((p) => y(p.upper)))) {
      plot.append(svg('path', { d, class: 'band' }));
    }
    plot.append(svg('path', { d: pathFrom(points.map((p, i) => (Number.isFinite(p.expected) ? [xs[i], y(p.expected)] : null))), class: 'expected' }));
    plot.append(svg('path', { d: pathFrom(points.map((p, i) => (Number.isFinite(p.value) ? [xs[i], y(p.value)] : null))), class: 'value' }));

    points.forEach((p, i) => {
      if (!Number.isFinite(p.value)) return;
      const cx = xs[i];
      const cy = y(p.value);
      if (p.severity === 'anomalia') {
        root.append(svg('circle', { cx, cy, r: 6, class: 'mark-anomaly' }));
      } else if (p.severity === 'obserwacja') {
        const s = 6;
        root.append(svg('path', { d: `M${cx},${cy - s}L${cx + s},${cy}L${cx},${cy + s}L${cx - s},${cy}Z`, class: 'mark-watch' }));
      } else if (i === sel || i === n - 1) {
        root.append(svg('circle', { cx, cy, r: 4, class: 'mark-point' }));
      }
    });

    // warstwa interakcji: celownik + tooltip, kliknięcie wybiera kwartał
    const cross = svg('line', { y1: m.top, y2: m.top + ih, class: 'crosshair', visibility: 'hidden' });
    root.append(cross);
    const hit = svg('rect', { x: m.left - step / 2, y: 0, width: iw + step, height: height, fill: 'transparent', tabindex: '0', class: 'hit' });
    root.append(hit);

    let focusIdx = sel;
    const show = (i, clientX, clientY) => {
      const p = points[i];
      cross.setAttribute('x1', xs[i]);
      cross.setAttribute('x2', xs[i]);
      cross.setAttribute('visibility', 'visible');
      showTooltip(r, p, clientX, clientY);
    };
    const hide = () => { cross.setAttribute('visibility', 'hidden'); hideTooltip(); };
    const idxFromEvent = (e) => {
      const box = root.getBoundingClientRect();
      const px = ((e.clientX - box.left) / box.width) * width;
      return Math.max(0, Math.min(n - 1, Math.round(((px - m.left) / iw) * (n - 1))));
    };
    hit.addEventListener('pointermove', (e) => show(idxFromEvent(e), e.clientX, e.clientY));
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('click', (e) => selectQuarter(points[idxFromEvent(e)].index));
    hit.addEventListener('focus', () => {
      const b = root.getBoundingClientRect();
      show(focusIdx, b.left + (xs[focusIdx] / width) * b.width, b.top + m.top);
    });
    hit.addEventListener('blur', hide);
    hit.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        focusIdx = Math.max(0, Math.min(n - 1, focusIdx + (e.key === 'ArrowLeft' ? -1 : 1)));
        const b = root.getBoundingClientRect();
        show(focusIdx, b.left + (xs[focusIdx] / width) * b.width, b.top + m.top);
      } else if (e.key === 'Enter') {
        selectQuarter(points[focusIdx].index);
      }
    });

    host.replaceChildren(root);
  }

  function showTooltip(r, p, clientX, clientY) {
    const { kpi } = r;
    const tip = $('#tooltip');
    const dev = deviation(r, p);
    const rows = [
      el('div', { class: 'tip-head' },
        el('span', { text: quarterLabel(p.index) }),
        p.severity === 'anomalia' || p.severity === 'obserwacja' ? chip(p.severity) : null),
      tipRow('key-value', withUnit(fmt(p.value, kpi), kpi), 'Wartość'),
      tipRow('key-expected', withUnit(fmt(p.expected, kpi), kpi), 'Oczekiwana'),
      tipRow('key-band', `${fmt(p.lower, kpi)} – ${fmt(p.upper, kpi)}`, 'Zakres normy'),
      tipRow(null, dev.text, 'Odchylenie'),
    ];
    tip.replaceChildren(...rows);
    tip.hidden = false;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let left = clientX + 14;
    if (left + w > window.innerWidth - 8) left = clientX - w - 14;
    let top = clientY - h - 10;
    if (top < 8) top = clientY + 16;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = top + 'px';
  }

  function tipRow(keyClass, value, label) {
    return el('div', { class: 'tip-row' },
      el('span', { class: 'tip-key ' + (keyClass || ''), 'aria-hidden': 'true' }),
      el('strong', { text: value }),
      el('span', { class: 'muted', text: label }));
  }

  function hideTooltip() {
    $('#tooltip').hidden = true;
  }

  // ---------- tabela danych ----------

  function renderDataTable() {
    const table = $('#data-table');
    table.replaceChildren();
    const head = el('tr', {}, el('th', { text: 'Kwartał' }));
    for (const r of state.results) head.append(el('th', { class: 'num', text: r.kpi.unit ? `${r.kpi.name} (${r.kpi.unit})` : r.kpi.name }));
    table.append(el('thead', {}, head));
    const body = el('tbody');
    for (let q = state.data.end; q >= state.data.start; q--) {
      const tr = el('tr', { class: q === state.quarter ? 'is-selected' : '' }, el('th', { scope: 'row', text: quarterLabel(q) }));
      for (const r of state.results) {
        const p = pointAt(r, q);
        const td = el('td', { class: 'num', text: fmt(p.value, r.kpi) });
        if (p.severity === 'anomalia' || p.severity === 'obserwacja') {
          td.classList.add('cell-' + p.severity);
          td.prepend(el('span', { class: 'cell-flag', title: SEVERITY_LABEL[p.severity], text: SEVERITY_ICON[p.severity] + ' ' }));
        }
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(body);
  }

  // ---------- zdarzenia ----------

  function init() {
    $('#quarter').addEventListener('change', (e) => selectQuarter(Number(e.target.value)));
    $('#sensitivity').addEventListener('change', (e) => {
      state.sensitivity = e.target.value;
      analyse();
      render();
    });
    $('#only-selected').addEventListener('change', renderAnomalyTable);
    $('#file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => load(reader.result, file.name);
      reader.readAsText(file, 'utf-8');
      e.target.value = '';
    });
    $('#reset').addEventListener('click', () => load(window.SAMPLE_CSV, 'Przykładowe dane'));
    $('#template').addEventListener('click', () => {
      const blob = new Blob(['\uFEFF' + window.SAMPLE_CSV.trim() + '\n'], { type: 'text/csv;charset=utf-8' });
      const a = el('a', { href: URL.createObjectURL(blob), download: 'wskazniki-przyklad.csv' });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

    let lastWidth = 0;
    new ResizeObserver(() => {
      const w = $('#charts').clientWidth;
      if (state.data && w !== lastWidth) { lastWidth = w; renderCharts(); }
    }).observe($('#charts'));

    load(window.SAMPLE_CSV, 'Przykładowe dane');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
