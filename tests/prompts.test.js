const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../prompty/js/prompts.js');

const T0 = '2026-01-01T00:00:00.000Z';
const mk = (o) => P.normalize({ title: 'x', prompt: 'y', ...o }, T0).item;

test('normalize: domyślne wartości i dopasowanie wyborów bez wielkości liter', () => {
  const { item, problems } = P.normalize({ title: '  Mail ', prompt: 'a\r\nb\n', category: 'excel', status: 'sprawdzony', places: 'chatgpt; Copilot w Word' }, T0);
  assert.equal(item.title, 'Mail');
  assert.equal(item.prompt, 'a\nb');
  assert.equal(item.category, 'Excel');
  assert.equal(item.status, 'Sprawdzony');
  assert.deepEqual(item.places, ['Copilot w Word', 'ChatGPT']); // kolejność z listy wyboru
  assert.deepEqual(problems, []);
  const d = P.normalize({ title: 'a', prompt: 'b' }, T0).item;
  assert.equal(d.category, 'inne');
  assert.equal(d.status, 'Szkic');
  assert.equal(d.created, T0);
});

test('normalize: nieznane wartości zgłaszane jako problemy', () => {
  const { item, problems } = P.normalize({ title: 'a', prompt: 'b', category: 'marketing', places: ';#Claude;#Notion;#' }, T0);
  assert.equal(item.category, 'inne');
  assert.deepEqual(item.places, ['Claude']);
  assert.equal(problems.length, 2);
});

test('validate: tytuł i prompt wymagane', () => {
  assert.equal(P.validate(mk({ title: ' ', prompt: '' })).length, 2);
  assert.deepEqual(P.validate(mk({})), []);
});

test('filterItems: wyszukiwanie bez polskich znaków, wszystkie słowa', () => {
  const items = [mk({ title: 'Streszczenie spotkania', notes: 'Działa źle przy długich' }), mk({ title: 'Formuła WYSZUKAJ' })];
  assert.equal(P.filterItems(items, { q: 'dzia' }).length, 1);
  assert.equal(P.filterItems(items, { q: 'zle dlugich' }).length, 1);
  assert.equal(P.filterItems(items, { q: 'zle formula' }).length, 0);
  assert.equal(P.filterItems(items, { q: 'FORMUŁA' }).length, 1);
});

test('filterItems: kategorie i „Gdzie działa” — dowolna z zaznaczonych', () => {
  const items = [
    mk({ category: 'Excel', places: ['Copilot w Excel'] }),
    mk({ category: 'pisanie', places: ['ChatGPT', 'Claude'] }),
    mk({ category: 'pisanie', places: [] }),
  ];
  assert.equal(P.filterItems(items, { categories: ['pisanie'] }).length, 2);
  assert.equal(P.filterItems(items, { places: ['Claude', 'Copilot w Excel'] }).length, 2);
  assert.equal(P.filterItems(items, { categories: ['pisanie'], places: ['Claude'] }).length, 1);
});

test('sortItems: polska kolejność alfabetyczna, kategorie wg listy, stabilność', () => {
  const items = [mk({ title: 'Żaba' }), mk({ title: 'ćma' }), mk({ title: 'Cebula' }), mk({ title: 'zebra' })];
  assert.deepEqual(P.sortItems(items, 'title', 'asc').map((i) => i.title), ['Cebula', 'ćma', 'zebra', 'Żaba']);
  assert.deepEqual(P.sortItems(items, 'title', 'desc').map((i) => i.title), ['Żaba', 'zebra', 'ćma', 'Cebula']);
  const cats = [mk({ title: 'b', category: 'inne' }), mk({ title: 'a', category: 'Excel' }), mk({ title: 'c', category: 'pisanie' })];
  assert.deepEqual(P.sortItems(cats, 'category', 'asc').map((i) => i.category), ['pisanie', 'Excel', 'inne']);
});

test('applyView: „Do sprawdzenia” = tylko szkice, „wg kategorii” grupuje w kolejności listy', () => {
  const items = [
    mk({ title: 'a', status: 'Szkic', category: 'spotkania' }),
    mk({ title: 'b', status: 'Sprawdzony', category: 'pisanie' }),
    mk({ title: 'c', status: 'Szkic', category: 'pisanie' }),
  ];
  const r = P.applyView(items, 'do-sprawdzenia', { status: 'Sprawdzony' }, { key: 'title', dir: 'asc' });
  assert.deepEqual(r.items.map((i) => i.title), ['a', 'c']); // widok nadpisuje filtr statusu
  const g = P.applyView(items, 'wg-kategorii', {}, { key: 'title', dir: 'desc' });
  assert.deepEqual(g.groups.map((x) => x.key), ['pisanie', 'spotkania']);
  assert.deepEqual(g.groups[0].items.map((i) => i.title), ['c', 'b']);
  assert.equal(P.applyView(items, 'nieznany').view.id, 'wszystkie');
});

test('CSV: eksport → import zachowuje wieloliniowy prompt, cudzysłowy i średniki', () => {
  const src = [mk({ title: 'Mail "na szybko"; wersja 2', prompt: 'Linia 1\nLinia 2; "cytat"\n\nLinia 4', category: 'pisanie', places: ['ChatGPT', 'Claude'], status: 'Sprawdzony', notes: 'ok' })];
  const csv = P.toCsv(src);
  assert.ok(csv.startsWith('﻿Tytuł;Prompt;Do czego służy;Kategoria;Gdzie działa;Uwagi;Status;Zmodyfikowano'));
  const back = P.fromCsv(csv);
  assert.deepEqual(back.errors, []);
  assert.deepEqual(back.warnings, []);
  const it = back.items[0];
  for (const k of ['title', 'prompt', 'category', 'status', 'notes', 'modified']) assert.equal(it[k], src[0][k], k);
  assert.deepEqual(it.places, ['ChatGPT', 'Claude']);
});

test('CSV: nagłówki z nazw wewnętrznych SharePoint, przecinek jako separator, błędne wiersze pomijane', () => {
  const csv = 'Title,Prompt,Kategoria,GdzieDziala,Status\r\n"A","p1",analiza,"Claude;Gemini",Szkic\r\n"",p2,,,\r\nB,"wiele\r\nlinii",x,,\r\n';
  const r = P.fromCsv(csv);
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items[0].places, ['Claude', 'Gemini']);
  assert.equal(r.items[1].prompt, 'wiele\nlinii');
  assert.equal(r.items[1].category, 'inne');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /Wiersz 3/);
  assert.equal(r.warnings.length, 1);
  assert.match(P.fromCsv('a;b\n1;2').errors[0], /Tytuł/);
});

test('merge: duplikat po tytule i treści aktualizowany tylko gdy nowszy', () => {
  const a = mk({ title: 'Mail', prompt: 'Napisz  mail', modified: '2026-02-01T00:00:00.000Z' });
  const older = { ...mk({ title: 'mail', prompt: 'Napisz mail' }), modified: '2026-01-15T00:00:00.000Z', notes: 'stare' };
  const newer = { ...older, modified: '2026-03-01T00:00:00.000Z', notes: 'nowe' };
  const fresh = mk({ title: 'Inny' });
  let r = P.merge([a], [older, fresh]);
  assert.equal(r.added, 1); assert.equal(r.updated, 0);
  r = P.merge([a], [newer]);
  assert.equal(r.updated, 1);
  assert.equal(r.items[0].notes, 'nowe');
  assert.equal(r.items[0].id, a.id);
});
