/* Interfejs biblioteki promptów. Logika listy: js/prompts.js. */
(function () {
  'use strict';
  const P = window.Prompts;
  const STORAGE_KEY = 'prompty.v1';

  const SORT_OPTIONS = [
    { key: 'modified', label: 'Ostatnio zmienione', dir: 'desc' },
    { key: 'title', label: 'Tytuł', dir: 'asc' },
    { key: 'category', label: 'Kategoria', dir: 'asc' },
    { key: 'status', label: 'Status', dir: 'asc' },
    { key: 'created', label: 'Data dodania', dir: 'desc' },
    { key: 'purpose', label: 'Do czego służy', dir: 'asc' },
    { key: 'places', label: 'Gdzie działa (liczba)', dir: 'desc' },
  ];

  // Przykłady widoczne przy pierwszym uruchomieniu — można je edytować lub usunąć.
  const EXAMPLES = [
    {
      title: 'Streszczenie spotkania z listą zadań',
      prompt: 'Na podstawie poniższej transkrypcji / notatek przygotuj:\n1. Streszczenie w 5 punktach (najważniejsze ustalenia).\n2. Tabelę zadań: zadanie | osoba | termin. Jeśli brak osoby lub terminu, wpisz „do ustalenia”.\n3. Otwarte pytania, na które nikt nie odpowiedział.\n\nPisz krótko, po polsku, bez ozdobników.\n\nNotatki:\n[WKLEJ TRANSKRYPCJĘ]',
      purpose: 'Szybka notatka po spotkaniu do wysłania uczestnikom.',
      category: 'spotkania', places: ['Copilot w Teams', 'Microsoft 365 Copilot', 'ChatGPT', 'Claude'],
      notes: 'W Teams działa najlepiej na nagranym spotkaniu z transkrypcją.', status: 'Sprawdzony',
    },
    {
      title: 'Uprzejma odpowiedź odmowna na maila',
      prompt: 'Napisz odpowiedź na poniższego maila. Muszę odmówić, ale chcę zachować dobrą relację.\nTon: uprzejmy, konkretny, bez przepraszania w każdym zdaniu. Maks. 120 słów.\nZaproponuj alternatywę: [ALTERNATYWA].\n\nMail:\n[WKLEJ MAILA]',
      purpose: 'Odmowa bez psucia relacji z klientem lub współpracownikiem.',
      category: 'pisanie', places: ['Copilot w Outlook', 'ChatGPT', 'Claude', 'Gemini'],
      notes: '', status: 'Sprawdzony',
    },
    {
      title: 'Formuła z opisu słownego',
      prompt: 'Jestem w Excelu (polska wersja, separator argumentów „;”).\nDane: [OPISZ KOLUMNY, np. A – data, B – dział, C – kwota].\nPotrzebuję formuły, która: [CO MA LICZYĆ].\nPodaj formułę, wyjaśnij ją w 2–3 zdaniach i wskaż, co może dać błąd.',
      purpose: 'Gdy wiesz, co chcesz policzyć, ale nie pamiętasz funkcji.',
      category: 'Excel', places: ['Copilot w Excel', 'ChatGPT', 'Claude'],
      notes: 'Copilot w Excelu wymaga danych w formie tabeli (Ctrl+T).', status: 'Szkic',
    },
    {
      title: 'Analiza za i przeciw decyzji',
      prompt: 'Rozważam decyzję: [OPIS DECYZJI].\nKontekst: [BUDŻET, TERMIN, OSOBY].\nPrzedstaw: argumenty za, argumenty przeciw, ryzyka i jak je ograniczyć, oraz 3 pytania, które powinnam/powinienem zadać przed decyzją.\nNie podejmuj decyzji za mnie.',
      purpose: 'Uporządkowanie myśli przed ważną decyzją.',
      category: 'analiza', places: ['Microsoft 365 Copilot', 'ChatGPT', 'Claude', 'Gemini'],
      notes: '', status: 'Szkic',
    },
    {
      title: 'Uproszczenie trudnego tekstu',
      prompt: 'Przepisz poniższy tekst prostym językiem dla osoby spoza branży.\nZachowaj wszystkie fakty i liczby. Krótkie zdania, bez żargonu; jeśli termin jest konieczny, objaśnij go w nawiasie.\n\nTekst:\n[WKLEJ TEKST]',
      purpose: 'Komunikaty do klientów, regulaminy, opisy procedur.',
      category: 'pisanie', places: ['Copilot w Word', 'ChatGPT', 'Claude'],
      notes: 'Sprawdź, czy nie zgubił wyjątków i warunków.', status: 'Szkic',
    },
  ];

  // ---------- stan ----------

  function load() {
    const now = Date.now();
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { /* brak localStorage */ }
    const items = raw && Array.isArray(raw.items)
      ? raw.items.map((it) => P.normalize(it).item)
      : EXAMPLES.map((ex, i) => P.normalize(ex, new Date(now - (i + 1) * 3600e3).toISOString()).item);
    const prefs = (raw && raw.prefs) || {};
    return {
      items,
      view: P.viewById(prefs.view).id,
      layout: prefs.layout === 'table' ? 'table' : 'cards',
      sort: SORT_OPTIONS.some((o) => o.key === (prefs.sort || {}).key) ? prefs.sort : { key: 'modified', dir: 'desc' },
      filter: { q: '', categories: [], places: [], status: '' },
      collapsed: new Set(prefs.collapsed || []),
    };
  }

  const state = load();
  let storageOk = true;

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        items: state.items,
        prefs: { view: state.view, layout: state.layout, sort: state.sort, collapsed: [...state.collapsed] },
      }));
    } catch (e) {
      if (storageOk) message('warn', 'Przeglądarka nie pozwala zapisywać danych (tryb prywatny?). Zmiany znikną po zamknięciu strony — użyj eksportu CSV.');
      storageOk = false;
    }
  }

  // ---------- narzędzia DOM ----------

  const $ = (sel) => document.querySelector(sel);

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) node.append(c);
    return node;
  }

  const catClass = (c) => 'cat cat-' + P.fold(c);
  const dateFmt = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtDate = (iso) => dateFmt.format(new Date(iso));
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    return `${n} ${n === 1 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many}`;
  };

  /** Podświetla słowa z wyszukiwania (bez rozróżniania wielkości liter i polskich znaków). */
  function highlight(text, words) {
    const s = String(text || '');
    if (!words.length || !s) return [s];
    const chars = Array.from(s);
    let folded = '';
    const map = []; // pozycja w `folded` → indeks znaku w `chars`
    chars.forEach((ch, i) => { const f = P.fold(ch); folded += f; for (let k = 0; k < f.length; k++) map.push(i); });
    const marks = new Array(chars.length).fill(false);
    for (const w of words) {
      let from = 0, at;
      while ((at = folded.indexOf(w, from)) >= 0) {
        for (let k = at; k < at + w.length; k++) marks[map[k]] = true;
        from = at + w.length;
      }
    }
    const out = [];
    let buf = '', on = false;
    const flush = () => { if (buf) out.push(on ? el('mark', null, buf) : buf); buf = ''; };
    chars.forEach((ch, i) => { if (marks[i] !== on) { flush(); on = marks[i]; } buf += ch; });
    flush();
    return out;
  }

  let toastTimer;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  function message(kind, text, list) {
    const box = $('#message');
    if (!kind) { box.replaceChildren(); return; }
    box.replaceChildren(el('div', { class: `msg msg-${kind}` },
      text,
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => message(null) }, 'Zamknij'),
      list && list.length ? el('ul', null, list.slice(0, 12).map((x) => el('li', null, x)),
        list.length > 12 ? el('li', null, `…i ${list.length - 12} więcej`) : null) : null));
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = el('textarea', { style: 'position:fixed;opacity:0' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      try { document.execCommand('copy'); } finally { ta.remove(); }
    }
    toast('Skopiowano prompt do schowka');
  }

  // ---------- render ----------

  function searchWords() { return P.fold(state.filter.q).split(/\s+/).filter(Boolean); }

  function renderSummary() {
    const c = P.counts(state.items);
    $('#summary').textContent = c.total
      ? `${plural(c.total, 'prompt', 'prompty', 'promptów')} · ${c.byStatus.Sprawdzony} sprawdzonych · ${c.byStatus.Szkic} do sprawdzenia`
      : 'Lista jest pusta — dodaj pierwszy prompt.';
  }

  function renderViews() {
    const c = P.counts(state.items);
    const n = { wszystkie: c.total, 'do-sprawdzenia': c.byStatus.Szkic, 'wg-kategorii': c.total };
    $('#views').replaceChildren(...P.VIEWS.map((v) => el('button', {
      type: 'button', role: 'tab', class: 'view-tab', 'aria-selected': String(v.id === state.view),
      onclick: () => { state.view = v.id; save(); render(); },
    }, v.label, el('span', { class: 'count' + (v.id === 'do-sprawdzenia' && n[v.id] ? ' count-draft' : '') }, String(n[v.id])))));
  }

  function renderFilters() {
    const c = P.counts(state.items);
    $('#cat-chips').replaceChildren(...P.CATEGORIES.map((cat) => {
      const on = state.filter.categories.includes(cat);
      return el('button', {
        type: 'button', class: 'chip-toggle ' + catClass(cat), 'aria-pressed': String(on),
        onclick: () => {
          const s = new Set(state.filter.categories);
          if (on) s.delete(cat); else s.add(cat);
          state.filter.categories = P.CATEGORIES.filter((x) => s.has(x));
          render();
        },
      }, el('span', { class: 'dot', 'aria-hidden': 'true' }), cat, el('span', { class: 'n' }, String(c.byCategory[cat])));
    }));

    const view = P.viewById(state.view);
    const st = $('#status');
    st.disabled = !!view.status;
    st.value = view.status || state.filter.status;
    st.title = view.status ? 'Widok „Do sprawdzenia” pokazuje tylko szkice' : '';
    $('#place').value = state.filter.places[0] || '';
    $('#sort-key').value = state.sort.key;
    const asc = state.sort.dir === 'asc';
    $('#sort-dir').textContent = asc ? '↑' : '↓';
    $('#sort-dir').title = asc ? 'Rosnąco (kliknij, aby odwrócić)' : 'Malejąco (kliknij, aby odwrócić)';
    document.querySelectorAll('[data-layout]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === state.layout)));
    const f = state.filter;
    $('#clear-filters').hidden = !(f.q || f.categories.length || f.places.length || f.status);
  }

  function statusBadge(s) {
    return el('span', { class: 'badge status' + (s === 'Sprawdzony' ? ' status-ok' : '') }, s);
  }
  function catBadge(c) {
    return el('span', { class: 'badge ' + catClass(c) }, el('span', { class: 'dot', 'aria-hidden': 'true' }), c);
  }

  function card(it, words) {
    const box = el('pre', { class: 'prompt-box' }, highlight(it.prompt, words));
    // Widoczność przycisku ustala fitPromptBoxes() po wyrenderowaniu (zawijanie zależy od szerokości).
    const more = el('button', {
      type: 'button', class: 'btn btn-ghost btn-sm more-btn', hidden: true,
      onclick: (e) => { const open = box.classList.toggle('is-open'); e.currentTarget.textContent = open ? 'Zwiń' : 'Pokaż całość'; },
    }, 'Pokaż całość');
    return el('article', { class: 'card ' + catClass(it.category) },
      el('div', { class: 'card-head' },
        el('h3', { class: 'card-title' }, el('button', { type: 'button', onclick: () => openEditor(it.id), title: 'Edytuj' }, highlight(it.title, words))),
        statusBadge(it.status)),
      it.purpose ? el('p', { class: 'purpose' }, highlight(it.purpose, words)) : null,
      box,
      it.notes ? el('p', { class: 'notes' }, highlight(it.notes, words)) : null,
      el('div', { class: 'card-meta' }, catBadge(it.category),
        it.places.length ? el('span', { class: 'tags' }, it.places.map((p) => el('span', { class: 'tag' }, p))) : null),
      el('div', { class: 'card-foot' },
        el('span', { class: 'muted small' }, 'zmieniono ' + fmtDate(it.modified)),
        el('span', { class: 'actions' }, more,
          el('button', { type: 'button', class: 'btn btn-sm', onclick: () => openEditor(it.id) }, 'Edytuj'),
          el('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => copyText(it.prompt) }, 'Kopiuj'))));
  }

  const TABLE_COLS = [
    { key: 'title', label: 'Tytuł', sortable: true },
    { key: 'category', label: 'Kategoria', sortable: true },
    { key: 'status', label: 'Status', sortable: true },
    { key: 'purpose', label: 'Do czego służy', sortable: true },
    { key: 'prompt', label: 'Prompt' },
    { key: 'places', label: 'Gdzie działa', sortable: true },
    { key: 'modified', label: 'Zmieniono', sortable: true },
    { key: 'copy', label: '' },
  ];

  function setSort(key) {
    if (state.sort.key === key) state.sort = { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' };
    else state.sort = { key, dir: (SORT_OPTIONS.find((o) => o.key === key) || { dir: 'asc' }).dir };
    save();
    render();
  }

  function row(it, words) {
    return el('tr', { onclick: () => openEditor(it.id), tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter') openEditor(it.id); } },
      el('td', { class: 'td-title' }, highlight(it.title, words)),
      el('td', { class: 'td-nowrap' }, catBadge(it.category)),
      el('td', { class: 'td-nowrap' }, statusBadge(it.status)),
      el('td', null, el('span', { class: 'clamp' }, highlight(it.purpose, words))),
      el('td', { class: 'td-prompt' }, el('span', { class: 'clamp' }, highlight(it.prompt, words))),
      el('td', null, el('span', { class: 'tags' }, it.places.map((p) => el('span', { class: 'tag' }, p)))),
      el('td', { class: 'td-nowrap muted' }, fmtDate(it.modified)),
      el('td', null, el('button', {
        type: 'button', class: 'btn btn-sm', title: 'Kopiuj prompt',
        onclick: (e) => { e.stopPropagation(); copyText(it.prompt); },
      }, 'Kopiuj')));
  }

  function table(items, groups, words) {
    const head = el('tr', null, TABLE_COLS.map((c) => {
      if (!c.sortable) return el('th', { scope: 'col' }, c.label);
      const on = state.sort.key === c.key;
      return el('th', { scope: 'col', 'aria-sort': on ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : null },
        el('button', { type: 'button', class: 'th-sort', onclick: () => setSort(c.key) },
          c.label, el('span', { class: 'arrow', 'aria-hidden': 'true' }, on ? (state.sort.dir === 'asc' ? '▲' : '▼') : '')));
    }));
    const body = groups
      ? groups.flatMap((g) => [
        el('tr', { class: 'group-row' }, el('td', { colspan: String(TABLE_COLS.length) },
          el('span', { class: 'badge ' + catClass(g.key) }, el('span', { class: 'dot' }), g.key), ' ',
          el('span', { class: 'muted' }, String(g.items.length)))),
        ...g.items.map((it) => row(it, words)),
      ])
      : items.map((it) => row(it, words));
    return el('div', { class: 'table-wrap' }, el('table', { class: 'table' }, el('thead', null, head), el('tbody', null, body)));
  }

  function render() {
    renderSummary();
    renderViews();
    renderFilters();
    const f = state.filter;
    const { items, groups, view } = P.applyView(state.items, state.view, f, state.sort);
    const words = searchWords();
    const res = $('#results');

    if (!state.items.length) {
      res.replaceChildren(el('div', { class: 'empty' },
        el('p', null, 'Nie ma jeszcze żadnych promptów.'),
        el('button', { type: 'button', class: 'btn btn-primary', onclick: () => openEditor(null) }, '+ Dodaj pierwszy prompt')));
      return;
    }
    if (!items.length) {
      const filtered = f.q || f.categories.length || f.places.length || (f.status && !view.status);
      res.replaceChildren(el('div', { class: 'empty' },
        el('p', null, filtered ? 'Żaden prompt nie pasuje do filtrów.' : view.status ? 'Wszystko sprawdzone — brak szkiców.' : 'Brak promptów.'),
        filtered ? el('button', { type: 'button', class: 'btn', onclick: clearFilters }, 'Wyczyść filtry') : null));
      return;
    }

    const lead = el('p', { class: 'muted small', style: 'margin:0 0 8px' },
      `Widok: ${view.label} · ${plural(items.length, 'wynik', 'wyniki', 'wyników')}`);

    if (state.layout === 'table') {
      res.replaceChildren(lead, table(items, groups, words));
    } else if (groups) {
      res.replaceChildren(lead, ...groups.map((g) => {
        const d = el('details', { class: 'group ' + catClass(g.key), open: !state.collapsed.has(g.key) },
          el('summary', null, el('span', { class: 'dot', 'aria-hidden': 'true' }), g.key,
            el('span', { class: 'count' }, String(g.items.length))),
          el('div', { class: 'cards' }, g.items.map((it) => card(it, words))));
        d.addEventListener('toggle', () => {
          if (d.open) fitPromptBoxes();
          if (d.open) state.collapsed.delete(g.key); else state.collapsed.add(g.key);
          save();
        });
        return d;
      }));
    } else {
      res.replaceChildren(lead, el('div', { class: 'cards' }, items.map((it) => card(it, words))));
    }
    fitPromptBoxes();
  }

  function fitPromptBoxes() {
    document.querySelectorAll('.card').forEach((c) => {
      const box = c.querySelector('.prompt-box');
      if (box.classList.contains('is-open')) return;
      const long = box.scrollHeight > box.clientHeight + 1;
      box.classList.toggle('is-long', long);
      c.querySelector('.more-btn').hidden = !long;
    });
  }
  let fitTimer;
  window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitPromptBoxes, 100); });

  function clearFilters() {
    state.filter = { q: '', categories: [], places: [], status: '' };
    $('#q').value = '';
    render();
  }

  // ---------- edytor ----------

  const dlg = $('#editor');
  const form = $('#editor-form');
  let editingId = null;
  let editorStatus = 'Szkic';
  let snapshot = '';

  function formData() {
    return {
      title: form.elements.title.value,
      prompt: form.elements.prompt.value,
      purpose: form.elements.purpose.value,
      category: form.elements.category.value,
      places: [...form.querySelectorAll('#places-checks input:checked')].map((x) => x.value),
      notes: form.elements.notes.value,
      status: editorStatus,
    };
  }

  function setEditorStatus(s) {
    editorStatus = s;
    document.querySelectorAll('#status-seg .seg').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.status === s)));
  }

  function openEditor(id) {
    const it = id ? state.items.find((x) => x.id === id) : null;
    editingId = it ? it.id : null;
    $('#editor-title').textContent = it ? 'Edytuj prompt' : 'Nowy prompt';
    const presetCat = state.filter.categories.length === 1 ? state.filter.categories[0] : 'inne';
    form.elements.title.value = it ? it.title : '';
    form.elements.prompt.value = it ? it.prompt : '';
    form.elements.purpose.value = it ? it.purpose : '';
    form.elements.category.value = it ? it.category : presetCat;
    form.elements.notes.value = it ? it.notes : '';
    form.querySelectorAll('#places-checks input').forEach((c) => { c.checked = !!it && it.places.includes(c.value); });
    setEditorStatus(it ? it.status : 'Szkic');
    $('#delete-btn').hidden = !it;
    $('#editor-errors').replaceChildren();
    $('#editor-meta').textContent = it ? `Dodano ${fmtDate(it.created)} · zmieniono ${fmtDate(it.modified)}` : '';
    snapshot = JSON.stringify(formData());
    dlg.showModal();
    form.elements.title.focus();
  }

  function isDirty() { return JSON.stringify(formData()) !== snapshot; }

  function closeEditor(force) {
    if (!force && isDirty() && !confirm('Porzucić niezapisane zmiany?')) return;
    dlg.close();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const prev = editingId ? state.items.find((x) => x.id === editingId) : null;
    const now = new Date().toISOString();
    const { item } = P.normalize({ ...formData(), id: editingId || undefined, created: prev ? prev.created : now, modified: now }, now);
    const errs = P.validate(item);
    if (errs.length) {
      $('#editor-errors').replaceChildren(el('p', { class: 'msg msg-error' }, errs.join(' ')));
      (item.title ? form.elements.prompt : form.elements.title).focus();
      return;
    }
    if (prev) state.items[state.items.indexOf(prev)] = item; else state.items.push(item);
    save();
    closeEditor(true);
    render();
    toast(prev ? 'Zapisano zmiany' : 'Dodano prompt');
  });

  $('#delete-btn').addEventListener('click', () => {
    const it = state.items.find((x) => x.id === editingId);
    if (!it || !confirm(`Usunąć prompt „${it.title}”? Tego nie da się cofnąć.`)) return;
    state.items = state.items.filter((x) => x !== it);
    save();
    closeEditor(true);
    render();
    toast('Usunięto prompt');
  });

  dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeEditor(false); });
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeEditor(false)));

  // ---------- import / eksport ----------

  $('#export-btn').addEventListener('click', () => {
    if (!state.items.length) { toast('Brak promptów do eksportu'); return; }
    const sorted = P.sortItems(state.items, 'title', 'asc');
    const blob = new Blob([P.toCsv(sorted)], { type: 'text/csv;charset=utf-8' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `prompty-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Wyeksportowano ${plural(sorted.length, 'prompt', 'prompty', 'promptów')}`);
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const { items, errors, warnings } = P.fromCsv(await file.text());
    if (!items.length) { message('error', 'Nie zaimportowano żadnego promptu.', errors); return; }
    const r = P.merge(state.items, items);
    state.items = r.items;
    save();
    render();
    const skipped = items.length - r.added - r.updated;
    const text = `Import: dodano ${r.added}, zaktualizowano ${r.updated}` + (skipped ? `, bez zmian ${skipped} (już były, w tej samej lub nowszej wersji)` : '') + '.';
    const notes = [...errors, ...warnings];
    message(notes.length ? 'warn' : 'info', text, notes);
  });

  // ---------- zdarzenia ----------

  function initControls() {
    $('#place').replaceChildren(el('option', { value: '' }, 'Wszędzie'), ...P.PLACES.map((p) => el('option', { value: p }, p)));
    $('#status').replaceChildren(el('option', { value: '' }, 'Wszystkie'), ...P.STATUSES.map((s) => el('option', { value: s }, s)));
    $('#sort-key').replaceChildren(...SORT_OPTIONS.map((o) => el('option', { value: o.key }, o.label)));
    form.elements.category.replaceChildren(...P.CATEGORIES.map((c) => el('option', { value: c }, c)));
    $('#places-checks').replaceChildren(...P.PLACES.map((p) => el('label', { class: 'check' }, el('input', { type: 'checkbox', value: p }), p)));
    $('#status-seg').replaceChildren(...P.STATUSES.map((s) => el('button', {
      type: 'button', class: 'seg', 'data-status': s, onclick: () => setEditorStatus(s),
    }, s)));

    let qTimer;
    $('#q').addEventListener('input', (e) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { state.filter.q = e.target.value; render(); }, 120);
    });
    $('#place').addEventListener('change', (e) => { state.filter.places = e.target.value ? [e.target.value] : []; render(); });
    $('#status').addEventListener('change', (e) => { state.filter.status = e.target.value; render(); });
    $('#sort-key').addEventListener('change', (e) => {
      state.sort = { key: e.target.value, dir: (SORT_OPTIONS.find((o) => o.key === e.target.value) || { dir: 'asc' }).dir };
      save(); render();
    });
    $('#sort-dir').addEventListener('click', () => { state.sort = { ...state.sort, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' }; save(); render(); });
    document.querySelectorAll('[data-layout]').forEach((b) => b.addEventListener('click', () => { state.layout = b.dataset.layout; save(); render(); }));
    $('#clear-filters').addEventListener('click', clearFilters);
    $('#add-btn').addEventListener('click', () => openEditor(null));

    document.addEventListener('keydown', (e) => {
      if (dlg.open || e.ctrlKey || e.metaKey || e.altKey) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); }
      else if ((e.key === 'n' || e.key === 'N') && !typing) { e.preventDefault(); openEditor(null); }
      else if (e.key === 'Escape' && document.activeElement === $('#q') && $('#q').value) { $('#q').value = ''; state.filter.q = ''; render(); }
    });
  }

  initControls();
  render();
  save(); // zapisuje przykłady przy pierwszym uruchomieniu
})();
