/*
 * Wczytywanie danych wskaźników z CSV w formacie "długim":
 *   wskaznik;jednostka;kierunek;kwartal;wartosc
 * Separator ; , lub tabulator (wykrywany z nagłówka). Kolumny jednostka i kierunek są opcjonalne.
 * kierunek: "wyżej" (więcej = lepiej), "niżej" (mniej = lepiej) lub puste (neutralny).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./anomalies.js'));
  else root.KpiData = factory(root.Anomalies);
})(typeof self !== 'undefined' ? self : this, function (Anomalies) {
  'use strict';

  const COLUMN_ALIASES = {
    name: ['wskaznik', 'kpi', 'nazwa', 'metric', 'indicator'],
    unit: ['jednostka', 'unit'],
    direction: ['kierunek', 'direction', 'cel'],
    quarter: ['kwartal', 'quarter', 'okres', 'period'],
    value: ['wartosc', 'value'],
  };

  function normalizeHeader(h) {
    return h.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
  }

  function splitRows(text, delimiter) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === delimiter) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((f) => f.trim() !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some((f) => f.trim() !== '')) rows.push(row);
    return rows;
  }

  function parseNumber(raw) {
    let s = String(raw).replace(/[\s\u00a0%]/g, '');
    if (s === '') return { value: NaN, decimals: 0 };
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else if (lastComma >= 0) s = s.replace(/,/g, '');
    const value = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) ? Number(s) : NaN;
    const dot = s.indexOf('.');
    return { value, decimals: dot >= 0 ? s.length - dot - 1 : 0 };
  }

  function parseDirection(raw) {
    const s = normalizeHeader(raw || '');
    if (['wyzej', 'wzrost', 'up', 'higher', '+', 'max'].includes(s)) return 'up';
    if (['nizej', 'spadek', 'down', 'lower', '-', 'min'].includes(s)) return 'down';
    return null;
  }

  function parseCsv(text) {
    text = String(text).replace(/^\uFEFF/, '').trim();
    const errors = [];
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const delimiter = ['\t', ';', ','].reduce((best, d) =>
      firstLine.split(d).length > firstLine.split(best).length ? d : best, ';');
    const rows = splitRows(text, delimiter);
    if (rows.length < 2) return { kpis: [], start: null, end: null, errors: ['Plik nie zawiera danych.'] };

    const header = rows[0].map(normalizeHeader);
    const col = {};
    for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
      col[key] = header.findIndex((h) => aliases.includes(h));
    }
    const missing = ['name', 'quarter', 'value'].filter((k) => col[k] < 0);
    if (missing.length) {
      return {
        kpis: [], start: null, end: null,
        errors: ['Brak wymaganych kolumn: ' + missing.map((k) => COLUMN_ALIASES[k][0]).join(', ') + '.'],
      };
    }

    const byName = new Map();
    rows.slice(1).forEach((r, i) => {
      const line = i + 2;
      const name = (r[col.name] || '').trim();
      const q = Anomalies.parseQuarter(r[col.quarter] || '');
      const num = parseNumber(r[col.value] || '');
      if (!name) { errors.push(`Wiersz ${line}: brak nazwy wskaźnika.`); return; }
      if (q === null) { errors.push(`Wiersz ${line}: nierozpoznany kwartał „${r[col.quarter]}”.`); return; }
      if (!Number.isFinite(num.value)) { errors.push(`Wiersz ${line}: nieprawidłowa wartość „${r[col.value]}”.`); return; }
      if (!byName.has(name)) {
        byName.set(name, { name, unit: '', direction: null, decimals: 0, obs: new Map() });
      }
      const k = byName.get(name);
      if (col.unit >= 0 && r[col.unit] && !k.unit) k.unit = r[col.unit].trim();
      if (col.direction >= 0 && !k.direction) k.direction = parseDirection(r[col.direction]);
      k.decimals = Math.min(2, Math.max(k.decimals, num.decimals));
      if (k.obs.has(q)) errors.push(`Wiersz ${line}: zdublowany kwartał ${Anomalies.quarterLabel(q)} dla „${name}” — użyto ostatniej wartości.`);
      k.obs.set(q, num.value);
    });

    const all = [...byName.values()].flatMap((k) => [...k.obs.keys()]);
    if (!all.length) return { kpis: [], start: null, end: null, errors };
    const start = Math.min(...all);
    const end = Math.max(...all);
    const kpis = [...byName.values()].map((k) => {
      const values = [];
      for (let q = start; q <= end; q++) values.push(k.obs.has(q) ? k.obs.get(q) : null);
      return { name: k.name, unit: k.unit, direction: k.direction, decimals: k.decimals, values };
    });
    return { kpis, start, end, errors };
  }

  return { parseCsv, parseNumber, parseDirection };
});
