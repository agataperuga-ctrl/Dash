/*
 * Biblioteka promptów zespołu — schemat listy, walidacja, widoki, filtrowanie,
 * sortowanie, grupowanie oraz import/eksport CSV.
 *
 * Schemat odpowiada liście Microsoft Lists / SharePoint tworzonej skryptem
 * prompty/sharepoint/utworz-liste.ps1 (te same nazwy wewnętrzne kolumn),
 * więc CSV wyeksportowany z listy da się tu zaimportować i odwrotnie.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Prompts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATEGORIES = ['pisanie', 'analiza', 'Excel', 'spotkania', 'inne'];
  const STATUSES = ['Szkic', 'Sprawdzony'];
  // Lista wyboru „Gdzie działa” — do zmiany w jednym miejscu (i w skrypcie SharePoint).
  const PLACES = [
    'Microsoft 365 Copilot', 'Copilot w Word', 'Copilot w Excel', 'Copilot w Outlook',
    'Copilot w Teams', 'ChatGPT', 'Claude', 'Gemini',
  ];

  // key — pole w aplikacji; internal — nazwa wewnętrzna kolumny w SharePoint; label — nagłówek.
  const FIELDS = [
    { key: 'title', internal: 'Title', label: 'Tytuł', type: 'text', required: true },
    { key: 'prompt', internal: 'Prompt', label: 'Prompt', type: 'note', required: true },
    { key: 'purpose', internal: 'DoCzegoSluzy', label: 'Do czego służy', type: 'note' },
    { key: 'category', internal: 'Kategoria', label: 'Kategoria', type: 'choice', choices: CATEGORIES, required: true },
    { key: 'places', internal: 'GdzieDziala', label: 'Gdzie działa', type: 'multichoice', choices: PLACES },
    { key: 'notes', internal: 'Uwagi', label: 'Uwagi', type: 'note' },
    { key: 'status', internal: 'Status', label: 'Status', type: 'choice', choices: STATUSES, required: true },
    { key: 'modified', internal: 'Modified', label: 'Zmodyfikowano', type: 'date', system: true },
    { key: 'created', internal: 'Created', label: 'Utworzono', type: 'date', system: true },
  ];

  const VIEWS = [
    { id: 'wszystkie', label: 'Wszystkie' },
    { id: 'do-sprawdzenia', label: 'Do sprawdzenia', status: 'Szkic' },
    { id: 'wg-kategorii', label: 'Pogrupowane wg kategorii', groupBy: 'category' },
  ];

  const collator = new Intl.Collator('pl', { sensitivity: 'base', numeric: true });

  // Porównanie bez wielkości liter i polskich znaków („łódź” ≈ „LODZ”).
  function fold(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/ł/g, 'l')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }

  function matchChoice(value, choices) {
    const f = fold(value).trim();
    if (!f) return '';
    return choices.find((c) => fold(c) === f) || null;
  }

  function newId() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function splitMulti(v) {
    if (Array.isArray(v)) return v;
    const s = String(v == null ? '' : v).trim();
    if (!s) return [];
    if (s.startsWith('[')) {
      try { const a = JSON.parse(s); if (Array.isArray(a)) return a; } catch (e) { /* zwykły tekst */ }
    }
    // SharePoint zapisuje wielokrotny wybór jako „;#A;#B;#” albo „A; B”.
    return s.split(/;#|;|,|\n/).map((x) => x.trim()).filter(Boolean);
  }

  /** Doprowadza rekord do postaci kanonicznej; nieznane wartości wyboru zgłasza w `problems`. */
  function normalize(raw, now) {
    const r = raw || {};
    const ts = now || new Date().toISOString();
    const problems = [];
    const str = (v) => String(v == null ? '' : v).replace(/\r\n?/g, '\n');

    let category = matchChoice(r.category, CATEGORIES);
    if (category === null) { problems.push(`nieznana kategoria „${r.category}” → „inne”`); category = 'inne'; }
    if (!category) category = 'inne';

    let status = matchChoice(r.status, STATUSES);
    if (status === null) { problems.push(`nieznany status „${r.status}” → „Szkic”`); status = 'Szkic'; }
    if (!status) status = 'Szkic';

    const places = [];
    for (const p of splitMulti(r.places)) {
      const m = matchChoice(p, PLACES);
      if (m) { if (!places.includes(m)) places.push(m); } else problems.push(`nieznane „Gdzie działa”: „${p}” — pominięte`);
    }
    places.sort((a, b) => PLACES.indexOf(a) - PLACES.indexOf(b));

    const validDate = (d) => (d && !Number.isNaN(new Date(d).getTime()) ? new Date(d).toISOString() : null);
    const created = validDate(r.created) || ts;
    const item = {
      id: r.id ? String(r.id) : newId(),
      title: str(r.title).trim(),
      prompt: str(r.prompt).replace(/^\n+|\s+$/g, ''),
      purpose: str(r.purpose).trim(),
      category,
      places,
      notes: str(r.notes).trim(),
      status,
      created,
      modified: validDate(r.modified) || created,
    };
    return { item, problems };
  }

  /** Zwraca listę błędów blokujących zapis (puste = OK). */
  function validate(item) {
    const errors = [];
    if (!item.title || !item.title.trim()) errors.push('Podaj tytuł.');
    if (!item.prompt || !item.prompt.trim()) errors.push('Wpisz treść promptu.');
    if (item.title && item.title.length > 255) errors.push('Tytuł może mieć najwyżej 255 znaków (limit SharePoint).');
    if (!CATEGORIES.includes(item.category)) errors.push('Wybierz kategorię.');
    if (!STATUSES.includes(item.status)) errors.push('Wybierz status.');
    return errors;
  }

  /**
   * Filtr: { q, categories: [], places: [], status: '' }.
   * Kategorie i „Gdzie działa”: wystarczy dowolna z zaznaczonych wartości.
   * Wyszukiwanie: wszystkie słowa muszą wystąpić w tytule, prompcie, celu lub uwagach.
   */
  function filterItems(items, f) {
    const opt = f || {};
    const words = fold(opt.q).split(/\s+/).filter(Boolean);
    const cats = opt.categories || [];
    const places = opt.places || [];
    return items.filter((it) => {
      if (opt.status && it.status !== opt.status) return false;
      if (cats.length && !cats.includes(it.category)) return false;
      if (places.length && !it.places.some((p) => places.includes(p))) return false;
      if (words.length) {
        const hay = fold([it.title, it.prompt, it.purpose, it.notes].join('\n'));
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
  }

  const SORTS = {
    title: (a, b) => collator.compare(a.title, b.title),
    category: (a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category),
    status: (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status),
    places: (a, b) => a.places.length - b.places.length || collator.compare(a.places.join(), b.places.join()),
    purpose: (a, b) => collator.compare(a.purpose, b.purpose),
    modified: (a, b) => (a.modified < b.modified ? -1 : a.modified > b.modified ? 1 : 0),
    created: (a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : 0),
  };

  /** Sortowanie stabilne; remisy rozstrzyga tytuł (zawsze rosnąco). */
  function sortItems(items, key, dir) {
    const cmp = SORTS[key] || SORTS.title;
    const sign = dir === 'desc' ? -1 : 1;
    return items
      .map((it, i) => ({ it, i }))
      .sort((x, y) => sign * cmp(x.it, y.it) || SORTS.title(x.it, y.it) || x.i - y.i)
      .map((x) => x.it);
  }

  /** Grupy w kolejności z listy wyboru; puste grupy pomijane. */
  function groupByCategory(items) {
    return CATEGORIES
      .map((c) => ({ key: c, items: items.filter((it) => it.category === c) }))
      .filter((g) => g.items.length);
  }

  function viewById(id) {
    return VIEWS.find((v) => v.id === id) || VIEWS[0];
  }

  /** Stosuje widok + filtr użytkownika + sortowanie. Zwraca { view, items, groups }. */
  function applyView(items, viewId, filter, sort) {
    const view = viewById(viewId);
    const f = { ...(filter || {}) };
    if (view.status) f.status = view.status;
    const s = sort || { key: 'title', dir: 'asc' };
    const out = sortItems(filterItems(items, f), s.key, s.dir);
    return { view, items: out, groups: view.groupBy ? groupByCategory(out) : null };
  }

  function counts(items) {
    const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const it of items) { byCategory[it.category]++; byStatus[it.status]++; }
    return { total: items.length, byCategory, byStatus };
  }

  // ---------- CSV ----------

  function csvCell(v, sep) {
    const s = String(v == null ? '' : v);
    return /["\n\r]/.test(s) || s.includes(sep) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** CSV z separatorem „;” i BOM (Excel w polskich ustawieniach otwiera go poprawnie). */
  function toCsv(items) {
    const sep = ';';
    const cols = FIELDS.filter((f) => !f.system || f.key === 'modified');
    const head = cols.map((f) => csvCell(f.label, sep)).join(sep);
    const rows = items.map((it) => cols.map((f) => {
      const v = it[f.key];
      return csvCell(Array.isArray(v) ? v.join('; ') : v, sep);
    }).join(sep));
    return '﻿' + [head, ...rows].join('\r\n') + '\r\n';
  }

  /** Parser RFC 4180: cudzysłowy, podwojone cudzysłowy, wieloliniowe pola. */
  function parseCsv(text) {
    let s = String(text || '').replace(/^﻿/, '');
    const firstLine = s.split(/\r?\n/, 1)[0] || '';
    const sep = [';', '\t', ','].map((c) => [c, firstLine.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) {
        if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  function headerKey(h) {
    const f = fold(h).replace(/[^a-z0-9]/g, '');
    for (const fld of FIELDS) {
      if (f === fold(fld.label).replace(/[^a-z0-9]/g, '') || f === fold(fld.internal) || f === fld.key) return fld.key;
    }
    const aliases = { nazwa: 'title', tresc: 'prompt', cel: 'purpose', opis: 'purpose', narzedzia: 'places', notatki: 'notes', id: 'id', identyfikator: 'id' };
    return aliases[f] || null;
  }

  /** Zwraca { items, errors, warnings }. Wiersze bez tytułu lub promptu są pomijane. */
  function fromCsv(text) {
    const rows = parseCsv(text);
    const errors = [], warnings = [], items = [];
    if (!rows.length) return { items, errors: ['Plik jest pusty.'], warnings };
    const keys = rows[0].map(headerKey);
    if (!keys.includes('title') || !keys.includes('prompt')) {
      return { items, errors: ['Brak wymaganych kolumn „Tytuł” i „Prompt” w pierwszym wierszu.'], warnings };
    }
    rows.slice(1).forEach((cells, i) => {
      const raw = {};
      keys.forEach((k, j) => { if (k && cells[j] != null) raw[k] = cells[j]; });
      const { item, problems } = normalize(raw);
      const errs = validate(item);
      if (errs.length) errors.push(`Wiersz ${i + 2}: ${errs.join(' ')} — pominięty.`);
      else {
        items.push(item);
        problems.forEach((p) => warnings.push(`Wiersz ${i + 2}: ${p}.`));
      }
    });
    return { items, errors, warnings };
  }

  /**
   * Scala import z istniejącą listą: ten sam id albo ten sam tytuł + prompt = ten sam rekord
   * (nowsza data modyfikacji wygrywa). Zwraca { items, added, updated }.
   */
  function merge(existing, incoming) {
    const out = existing.slice();
    let added = 0, updated = 0;
    const sig = (it) => fold(it.title).trim() + '\u0000' + fold(it.prompt).replace(/\s+/g, ' ').trim();
    for (const inc of incoming) {
      const idx = out.findIndex((it) => it.id === inc.id || sig(it) === sig(inc));
      if (idx < 0) { out.push(inc); added++; }
      else if (inc.modified > out[idx].modified) { out[idx] = { ...inc, id: out[idx].id, created: out[idx].created }; updated++; }
    }
    return { items: out, added, updated };
  }

  return {
    CATEGORIES, STATUSES, PLACES, FIELDS, VIEWS,
    fold, normalize, validate, filterItems, sortItems, groupByCategory, applyView, viewById, counts,
    toCsv, parseCsv, fromCsv, merge,
  };
});
