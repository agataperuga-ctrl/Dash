(function () {
  'use strict';

  const S = window.Scalp;
  const STORAGE_KEY = 'scalping.v1';

  // Przykładowe stawki — do nadpisania własnymi z tabeli opłat brokera.
  const PRESETS = {
    akcje: { label: 'Akcje', multiplier: 1, tick: 0.01, qtyStep: 1, feePct: 0.39, feePerUnit: 0, feeMin: 5, leverage: 1 },
    fw20: { label: 'Kontrakt FW20', multiplier: 20, tick: 1, qtyStep: 1, feePct: 0, feePerUnit: 9, feeMin: 0, leverage: 10 },
    krypto: { label: 'Kryptowaluty', multiplier: 1, tick: 0.01, qtyStep: 0.0001, feePct: 0.1, feePerUnit: 0, feeMin: 0, leverage: 1 },
    forex: { label: 'Forex (1 lot = 100 000)', multiplier: 100000, tick: 0.00001, qtyStep: 0.01, feePct: 0, feePerUnit: 0, feeMin: 0, leverage: 30 },
    wlasny: { label: 'Własny', multiplier: 1, tick: 0.01, qtyStep: 1, feePct: 0, feePerUnit: 0, feeMin: 0, leverage: 1 },
  };
  const INST_FIELDS = ['multiplier', 'tick', 'qtyStep', 'feePct', 'feePerUnit', 'feeMin', 'leverage'];
  const ACCOUNT_FIELDS = ['capital', 'riskPct', 'maxDailyLossPct', 'maxTrades', 'maxLossStreak'];

  const DEFAULTS = {
    capital: 10000, currency: 'PLN', riskPct: 0.5,
    maxDailyLossPct: 2, maxTrades: 15, maxLossStreak: 3,
    preset: 'akcje', inst: { ...PRESETS.akcje },
    side: 'long', entry: '', stop: '', tpMode: 'r', tpValue: '1.5',
    symbol: '', range: 'today',
  };

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        return {
          settings: { ...DEFAULTS, ...raw.settings, inst: { ...DEFAULTS.inst, ...(raw.settings || {}).inst } },
          trades: Array.isArray(raw.trades) ? raw.trades : [],
        };
      }
    } catch (e) { /* brak dostępu do localStorage — działamy bez zapisu */ }
    return { settings: { ...DEFAULTS, inst: { ...DEFAULTS.inst } }, trades: [] };
  }

  const state = { ...load(), result: null, qtyTouched: false };

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: state.settings, trades: state.trades }));
    } catch (e) { /* jw. */ }
  }

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

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

  // ---------- formatowanie ----------

  function num(x, decimals) {
    if (!Number.isFinite(x)) return '—';
    return x.toLocaleString('pl-PL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).replace('-', '−');
  }
  const priceDecimals = () => Math.max(S.decimalsOf(state.settings.inst.tick), 0);
  const price = (x) => num(x, priceDecimals());
  const qtyFmt = (x) => num(x, S.decimalsOf(state.settings.inst.qtyStep));
  const money = (x) => (Number.isFinite(x) ? `${num(x, 2)} ${state.settings.currency}` : '—');
  const signedMoney = (x) => (x > 0 ? '+' : '') + money(x);
  const tone = (x) => (x > 0 ? 'tone-good' : x < 0 ? 'tone-bad' : 'tone-neutral');
  const ticks = (x) => (Number.isFinite(x) ? `${num(x, Number.isInteger(Math.round(x * 1e6) / 1e6) ? 0 : 1)} tick.` : '');

  // Wartość pola do zapisu w polu formularza (bez separatorów tysięcy, z przecinkiem dziesiętnym).
  const inputValue = (x, decimals) => (Number.isFinite(x) ? x.toFixed(decimals).replace('.', ',') : '');

  function message(host, kind, lines) {
    host.replaceChildren();
    if (!lines.length) return;
    const box = el('div', { class: `msg msg-${kind}` });
    if (lines.length === 1) box.textContent = lines[0];
    else box.append(el('ul', null, ...lines.map((l) => el('li', { text: l }))));
    host.append(box);
  }

  // ---------- dane bieżące ----------

  const today = () => S.localDay(new Date().toISOString());
  const todayTrades = () => state.trades.filter((t) => S.localDay(t.time) === today());

  function guard() {
    const s = state.settings;
    return S.riskGuard(todayTrades(), {
      maxDailyLossPct: S.parseNum(s.maxDailyLossPct),
      maxTrades: S.parseNum(s.maxTrades),
      maxLossStreak: S.parseNum(s.maxLossStreak),
    }, S.parseNum(s.capital));
  }

  function calculate(g) {
    const s = state.settings;
    const tp = S.parseNum(s.tpValue);
    return S.sizePosition({
      capital: S.parseNum(s.capital),
      riskPct: S.parseNum(s.riskPct),
      side: s.side,
      entry: S.parseNum(s.entry),
      stop: S.parseNum(s.stop),
      target: s.tpMode === 'price' ? tp : NaN,
      targetR: s.tpMode === 'r' ? tp : NaN,
      dailyRemaining: g.remaining,
    }, instrument());
  }

  function instrument() {
    const inst = {};
    for (const f of INST_FIELDS) inst[f] = S.parseNum(state.settings.inst[f]) || 0;
    if (!(inst.leverage > 0)) inst.leverage = 1;
    return inst;
  }

  // ---------- render ----------

  function renderResult(r) {
    const host = $('#result');
    host.replaceChildren();
    message($('#calc-messages'), r.ok ? 'warn' : 'error', r.ok ? r.warnings : r.errors);
    if (!r.ok) return;

    const pctCap = (x) => `${num((x / S.parseNum(state.settings.capital)) * 100, 2)}% kapitału`;
    const row = (label, value, sub, cls) => el('div', { class: 'kv' },
      el('span', { class: 'kv-label', text: label }),
      el('span', { class: `kv-value ${cls || ''}`, text: value }),
      sub ? el('span', { class: 'kv-sub', text: sub }) : null);

    host.append(
      el('div', { class: 'headline' },
        el('span', { class: 'kv-label', text: 'Wielkość pozycji' }),
        el('span', { class: 'big', text: qtyFmt(r.qty) }),
        el('span', { class: 'kv-sub', text: `ograniczenie: ${r.limitedBy}` })),
      el('div', { class: 'kv-grid' },
        row('Strata na SL (netto)', money(-r.lossAtStop), pctCap(r.lossAtStop), 'tone-bad'),
        row('Zysk na TP (netto)', money(r.profitAtTarget), Number.isFinite(r.target) ? `TP ${price(r.target)} · ${ticks(r.targetTicks)}` : 'brak TP', tone(r.profitAtTarget)),
        row('R:R netto', Number.isFinite(r.rrNet) ? `1 : ${num(r.rrNet, 2)}` : '—', Number.isFinite(r.rrGross) ? `brutto 1 : ${num(r.rrGross, 2)}` : ''),
        row('Próg rentowności', price(r.breakEvenTick), `${ticks(r.breakEvenTicks)} od wejścia`),
        row('Stop', price(r.stop), ticks(r.stopTicks)),
        row('Wartość pozycji', money(r.positionValue), r.margin < r.positionValue ? `depozyt ${money(r.margin)}` : ''),
        row('Prowizje (wejście + SL)', money(r.feesAtStop), Number.isFinite(r.feesAtTarget) ? `przy TP ${money(r.feesAtTarget)}` : ''),
        row('Budżet ryzyka', money(r.budget), r.budget < r.riskBudget ? `z ${money(r.riskBudget)}` : '')));
  }

  function renderGuard(g) {
    const host = $('#guard');
    host.replaceChildren();
    const pill = $('#guard-pill');
    const PILL = { ok: 'Można handlować', uwaga: 'Uwaga — blisko limitu', stop: 'STOP — limit osiągnięty' };
    pill.className = `pill pill-${g.status}`;
    pill.textContent = PILL[g.status];

    if (!g.checks.length) {
      host.append(el('p', { class: 'muted', text: 'Wszystkie limity wyłączone.' }));
    }
    for (const c of g.checks) {
      const value = c.key === 'loss' ? `${money(c.used)} / ${money(c.limit)}` : `${c.used} / ${c.limit}`;
      host.append(el('div', { class: `check check-${c.status}` },
        el('div', { class: 'check-head' }, el('span', { text: c.label }), el('strong', { text: value })),
        el('div', { class: 'meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': String(c.limit), 'aria-valuenow': String(c.used), 'aria-label': c.label },
          el('span', { style: `width:${Math.min(100, c.ratio * 100)}%` }))));
    }
    const st = g.stats;
    host.append(el('p', { class: 'guard-summary' },
      'Wynik dnia: ', el('strong', { class: tone(st.net), text: signedMoney(st.net) }),
      ` · ${st.count} transakcji`,
      Number.isFinite(g.remaining) ? ` · do limitu straty: ${money(Math.max(0, g.remaining))}` : ''));
  }

  function renderPreview() {
    const s = state.settings;
    const entry = S.parseNum(s.entry);
    const exit = S.parseNum($('#exit').value);
    const qty = S.parseNum($('#qty').value);
    const out = $('#trade-preview');
    if (!(entry > 0) || !(exit > 0) || !(qty > 0)) {
      out.textContent = 'Uzupełnij wejście w kalkulatorze, ilość i cenę wyjścia.';
      out.className = 'preview wide muted';
      return;
    }
    const p = S.tradePnl({ side: s.side, entry, exit, qty }, instrument());
    out.className = 'preview wide';
    out.replaceChildren(`${s.side === 'long' ? 'Long' : 'Short'} ${qtyFmt(qty)} @ ${price(entry)} → ${price(exit)}: `,
      el('strong', { class: tone(p.net), text: signedMoney(p.net) }),
      el('span', { class: 'muted', text: ` (prowizje ${money(p.fees)})` }));
  }

  function renderJournal() {
    const range = state.settings.range;
    $$('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === range)));
    const trades = (range === 'today' ? todayTrades() : state.trades)
      .slice().sort((a, b) => new Date(b.time) - new Date(a.time));
    const st = S.journalStats(trades);

    const tile = (label, value, cls) => el('div', { class: 'tile' },
      el('span', { class: 'kv-label', text: label }), el('span', { class: `tile-value ${cls || ''}`, text: value }));
    $('#stats').replaceChildren(
      tile('Wynik netto', signedMoney(st.net), tone(st.net)),
      tile('Transakcje', `${st.count}`),
      tile('Skuteczność', Number.isFinite(st.winRate) ? `${num(st.winRate * 100, 0)}%` : '—'),
      tile('Profit factor', st.profitFactor === Infinity ? '∞' : num(st.profitFactor, 2)),
      tile('Średni R', Number.isFinite(st.avgR) ? num(st.avgR, 2) : '—', tone(st.avgR)),
      tile('Śr. zysk / strata', `${num(st.avgWin, 2)} / ${num(st.avgLoss, 2)}`),
      tile('Prowizje', money(st.fees)),
      tile('Maks. obsunięcie', money(-st.maxDrawdown), st.maxDrawdown > 0 ? 'tone-bad' : ''));

    const body = $('#journal');
    body.replaceChildren();
    if (!trades.length) {
      body.append(el('tr', null, el('td', { class: 'empty', colspan: '11', text: range === 'today' ? 'Brak transakcji dzisiaj.' : 'Dziennik jest pusty.' })));
      return;
    }
    const sameDay = range === 'today';
    for (const t of trades) {
      const d = new Date(t.time);
      const time = sameDay ? d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
      const r = t.risk > 0 ? t.net / t.risk : NaN;
      body.append(el('tr', null,
        el('td', { text: time }),
        el('td', { text: t.symbol || '—' }),
        el('td', null, el('span', { class: `side side-${t.side}`, text: t.side === 'long' ? 'Long' : 'Short' })),
        el('td', { class: 'num', text: num(t.entry, Math.max(priceDecimals(), S.decimalsOf(t.entry))) }),
        el('td', { class: 'num', text: num(t.exit, Math.max(priceDecimals(), S.decimalsOf(t.exit))) }),
        el('td', { class: 'num', text: num(t.qty, S.decimalsOf(t.qty)) }),
        el('td', { class: 'num', text: num(t.fees, 2) }),
        el('td', { class: `num ${tone(t.net)}`, text: num(t.net, 2) }),
        el('td', { class: `num ${tone(r)}`, text: Number.isFinite(r) ? num(r, 2) : '—' }),
        el('td', { class: 'note', text: t.note || '' }),
        el('td', null, el('button', {
          type: 'button', class: 'icon-button', title: 'Usuń transakcję', 'aria-label': 'Usuń transakcję',
          onclick: () => { state.trades = state.trades.filter((x) => x.id !== t.id); save(); render(); },
        }, '×'))));
    }
  }

  function render() {
    const g = guard();
    state.result = calculate(g);
    renderResult(state.result);
    renderGuard(g);
    if (!state.qtyTouched) $('#qty').value = state.result.ok ? inputValue(state.result.qty, S.decimalsOf(state.settings.inst.qtyStep)) : '';
    renderPreview();
    renderJournal();
    $$('[data-side]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.side === state.settings.side)));
  }

  // ---------- akcje ----------

  function setSide(side) {
    state.settings.side = side;
    save();
    render();
  }

  function fillExit(key) {
    const r = state.result;
    if (!r || !r.ok || !Number.isFinite(r[key])) return;
    $('#exit').value = inputValue(r[key], priceDecimals());
    renderPreview();
    $('#exit').focus();
  }

  function saveTrade(e) {
    e.preventDefault();
    const s = state.settings;
    const entry = S.parseNum(s.entry);
    const stop = S.parseNum(s.stop);
    const exit = S.parseNum($('#exit').value);
    const qty = S.parseNum($('#qty').value);
    const errors = [];
    if (!(entry > 0)) errors.push('Brak ceny wejścia w kalkulatorze.');
    if (!(exit > 0)) errors.push('Podaj cenę wyjścia.');
    if (!(qty > 0)) errors.push('Podaj ilość.');
    message($('#journal-messages'), 'error', errors);
    if (errors.length) { $(!(exit > 0) ? '#exit' : '#qty').focus(); return; }

    const inst = instrument();
    const p = S.tradePnl({ side: s.side, entry, exit, qty }, inst);
    const validStop = Number.isFinite(stop) && S.dirOf(s.side) * (entry - stop) > 0;
    const risk = validStop ? -S.tradePnl({ side: s.side, entry, exit: stop, qty }, inst).net : NaN;
    state.trades.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: new Date().toISOString(),
      symbol: $('#symbol').value.trim().toUpperCase(),
      side: s.side, entry, exit, qty, stop: validStop ? stop : NaN,
      fees: p.fees, net: p.net, risk,
      note: $('#note').value.trim(),
    });
    $('#exit').value = '';
    $('#note').value = '';
    state.qtyTouched = false;
    save();
    render();
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importCsv(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const { trades, errors } = S.fromCsv(String(reader.result));
      const known = new Set(state.trades.map((t) => `${t.time}|${t.entry}|${t.exit}|${t.qty}`));
      const fresh = trades.filter((t) => !known.has(`${t.time}|${t.entry}|${t.exit}|${t.qty}`));
      state.trades.push(...fresh);
      save();
      render();
      const skipped = trades.length - fresh.length;
      message($('#journal-messages'), errors.length ? 'warn' : 'ok', [
        `Zaimportowano ${fresh.length} transakcji${skipped ? `, pominięto ${skipped} duplikatów` : ''}.`, ...errors]);
    };
    reader.readAsText(file);
  }

  // ---------- inicjalizacja ----------

  function bindField(id, getTarget) {
    const input = $(`#${id}`);
    const target = getTarget();
    input.value = target[id] == null ? '' : String(target[id]).replace('.', ',');
    input.addEventListener('input', () => { getTarget()[id] = input.value; save(); render(); });
  }

  function init() {
    const s = state.settings;
    const presetSelect = $('#preset');
    for (const [key, p] of Object.entries(PRESETS)) presetSelect.append(el('option', { value: key, text: p.label }));
    presetSelect.value = s.preset in PRESETS ? s.preset : 'wlasny';
    presetSelect.addEventListener('change', () => {
      s.preset = presetSelect.value;
      const { label, ...params } = PRESETS[s.preset];
      s.inst = { ...params };
      for (const f of INST_FIELDS) $(`#${f}`).value = String(s.inst[f]).replace('.', ',');
      save();
      render();
    });

    // Przed bindField, żeby do ustawień trafiał już symbol wielkimi literami.
    $('#symbol').addEventListener('input', () => { $('#symbol').value = $('#symbol').value.toUpperCase(); });
    for (const f of [...ACCOUNT_FIELDS, 'currency', 'entry', 'stop', 'tpValue', 'symbol']) bindField(f, () => state.settings);
    for (const f of INST_FIELDS) bindField(f, () => state.settings.inst);

    const tpMode = $('#tpMode');
    tpMode.value = s.tpMode;
    tpMode.addEventListener('change', () => {
      s.tpMode = tpMode.value;
      // Przełączenie trybu przelicza bieżący TP, żeby nie zgubić ustawionego celu.
      const r = state.result;
      if (r && r.ok && Number.isFinite(r.target)) {
        s.tpValue = s.tpMode === 'price' ? inputValue(r.target, priceDecimals()) : inputValue(r.rrGross, 2);
        $('#tpValue').value = s.tpValue;
      }
      save();
      render();
    });

    $$('[data-side]').forEach((b) => b.addEventListener('click', () => setSide(b.dataset.side)));
    $$('[data-fill]').forEach((b) => b.addEventListener('click', () => fillExit(b.dataset.fill)));
    $$('[data-range]').forEach((b) => b.addEventListener('click', () => { s.range = b.dataset.range; save(); renderJournal(); }));

    $('#qty').addEventListener('input', () => { state.qtyTouched = $('#qty').value.trim() !== ''; renderPreview(); });
    $('#exit').addEventListener('input', renderPreview);
    $('#trade-form').addEventListener('submit', saveTrade);

    $('#export').addEventListener('click', () => download(`dziennik-scalping-${today()}.csv`, S.toCsv(state.trades)));
    $('#import').addEventListener('change', (e) => { if (e.target.files[0]) importCsv(e.target.files[0]); e.target.value = ''; });
    $('#clear').addEventListener('click', () => {
      const range = s.range;
      const scope = range === 'today' ? todayTrades() : state.trades;
      if (!scope.length) return;
      if (!confirm(range === 'today' ? `Usunąć ${scope.length} dzisiejszych transakcji?` : `Usunąć cały dziennik (${scope.length} transakcji)?`)) return;
      const ids = new Set(scope.map((t) => t.id));
      state.trades = state.trades.filter((t) => !ids.has(t.id));
      save();
      render();
    });

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest('input, select, textarea')) return;
      const key = e.key.toLowerCase();
      const action = { l: () => setSide('long'), s: () => setSide('short'), t: () => fillExit('target'), x: () => fillExit('stop'), b: () => fillExit('breakEvenTick') }[key];
      if (action) { e.preventDefault(); action(); }
    });

    render();
  }

  init();
})();
