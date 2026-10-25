const test = require('node:test');
const assert = require('node:assert/strict');
const { detect, parseQuarter, quarterLabel } = require('../js/anomalies.js');
const { parseCsv, parseNumber, parseDirection } = require('../js/data.js');

// Deterministyczny szum (LCG), żeby testy były powtarzalne.
function noise(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
}

function seasonalSeries(n, { base = 100, growth = 0.015, seasonal = [0.9, 1, 1, 1.1], amp = 0.03, seed = 1 } = {}) {
  const rnd = noise(seed);
  return Array.from({ length: n }, (_, i) => base * Math.exp(growth * i) * seasonal[i % 4] * (1 + amp * rnd()));
}

const START = 2020 * 4; // 2020-Q1

test('parseQuarter rozpoznaje popularne zapisy', () => {
  assert.equal(parseQuarter('2024-Q1'), 2024 * 4);
  assert.equal(parseQuarter('2024 q3'), 2024 * 4 + 2);
  assert.equal(parseQuarter('Q4 2023'), 2023 * 4 + 3);
  assert.equal(parseQuarter('2024Q2'), 2024 * 4 + 1);
  assert.equal(parseQuarter('III kw. 2025'), 2025 * 4 + 2);
  assert.equal(parseQuarter('2024-Q5'), null);
  assert.equal(parseQuarter('styczeń'), null);
  assert.equal(quarterLabel(parseQuarter('2026-Q3')), '2026-Q3');
});

test('parseNumber obsługuje przecinek dziesiętny i separatory tysięcy', () => {
  assert.equal(parseNumber('1 234,5').value, 1234.5);
  assert.equal(parseNumber('1,234.5').value, 1234.5);
  assert.equal(parseNumber('18,4%').value, 18.4);
  assert.equal(parseNumber('-3').value, -3);
  assert.equal(parseNumber('12,34').decimals, 2);
  assert.ok(Number.isNaN(parseNumber('abc').value));
  assert.ok(Number.isNaN(parseNumber('').value));
});

test('parseDirection', () => {
  assert.equal(parseDirection('wyżej'), 'up');
  assert.equal(parseDirection('Niżej'), 'down');
  assert.equal(parseDirection(''), null);
});

test('parseCsv: separator, polskie nagłówki, luki i błędne wiersze', () => {
  const csv = '\uFEFFWskaźnik;Kwartał;Wartość;Jednostka;Kierunek\n'
    + 'A;2024-Q1;1,5;%;wyżej\n'
    + 'A;2024-Q3;2,5;%;wyżej\n'
    + 'B;2024-Q2;10;szt.;niżej\n'
    + 'B;2024-Q9;10;szt.;niżej\n'
    + '"C; z średnikiem";2024-Q1;"3,25";;\n';
  const d = parseCsv(csv);
  assert.equal(d.start, 2024 * 4);
  assert.equal(d.end, 2024 * 4 + 2);
  assert.equal(d.errors.length, 1);
  const a = d.kpis.find((k) => k.name === 'A');
  assert.deepEqual(a.values, [1.5, null, 2.5]);
  assert.equal(a.unit, '%');
  assert.equal(a.direction, 'up');
  assert.equal(d.kpis.find((k) => k.name === 'B').direction, 'down');
  const c = d.kpis.find((k) => k.name === 'C; z średnikiem');
  assert.deepEqual(c.values, [3.25, null, null]);
  assert.equal(c.decimals, 2);
});

test('parseCsv: przecinek jako separator i brak wymaganych kolumn', () => {
  const d = parseCsv('kpi,quarter,value\nX,2023-Q4,5.5\nX,2024-Q1,6\n');
  assert.deepEqual(d.kpis[0].values, [5.5, 6]);
  const bad = parseCsv('wskaznik;wartosc\nA;1\n');
  assert.equal(bad.kpis.length, 0);
  assert.match(bad.errors[0], /kwartal/);
});

test('wykrywa pojedynczy spadek w szeregu sezonowym i nic poza nim', () => {
  const values = seasonalSeries(24);
  values[13] *= 0.8;
  const res = detect(values, START);
  assert.equal(res.model, 'mult');
  const flagged = res.points.filter((p) => p.severity === 'anomalia').map((p) => p.index - START);
  assert.deepEqual(flagged, [13]);
  assert.ok(res.points[13].z < 0);
});

test('sezonowość nie jest traktowana jak anomalia', () => {
  const values = seasonalSeries(24, { seasonal: [0.7, 1.0, 1.0, 1.3], seed: 5 });
  const res = detect(values, START);
  assert.equal(res.points.filter((p) => p.severity === 'anomalia').length, 0);
});

test('anomalia w ostatnim kwartale jest wykrywana', () => {
  const values = seasonalSeries(20, { seed: 9 });
  values[19] *= 1.3;
  const res = detect(values, START);
  assert.equal(res.points[19].severity, 'anomalia');
  assert.ok(res.points[19].z > 0);
});

test('silna anomalia nie oznacza sąsiadów (drugi przebieg)', () => {
  const values = seasonalSeries(24, { seed: 3 });
  values[22] *= 0.5;
  const res = detect(values, START);
  const flagged = res.points.filter((p) => p.severity === 'anomalia').map((p) => p.index - START);
  assert.deepEqual(flagged, [22]);
});

test('model addytywny dla wartości ujemnych', () => {
  const rnd = noise(11);
  const values = Array.from({ length: 16 }, (_, i) => -5 + 0.4 * i + rnd());
  values[8] = 20;
  const res = detect(values, START);
  assert.equal(res.model, 'add');
  const flagged = res.points.filter((p) => p.severity === 'anomalia').map((p) => p.index - START);
  assert.deepEqual(flagged, [8]);
});

test('luki w danych i za krótki szereg', () => {
  const values = seasonalSeries(16, { seed: 4 });
  values[5] = null;
  const res = detect(values, START);
  assert.equal(res.points[5].severity, 'brak');
  assert.ok(res.points.filter((p) => p.index !== START + 5).every((p) => Number.isFinite(p.expected)));

  const short = detect([1, 2, 3, 4, 5, 6, 7], START);
  assert.equal(short.enough, false);
  assert.ok(short.points.every((p) => p.severity === 'brak'));
});

test('stały szereg nie generuje anomalii ani błędów', () => {
  const res = detect(new Array(12).fill(50), START);
  assert.ok(res.points.every((p) => p.severity === 'brak' || p.severity === 'norma'));
});

test('zakres normy odpowiada progowi anomalii', () => {
  const values = seasonalSeries(24, { seed: 7, amp: 0.06 });
  values[10] *= 1.25;
  for (const sensitivity of ['niska', 'standardowa', 'wysoka']) {
    const res = detect(values, START, { sensitivity });
    for (const p of res.points) {
      if (!Number.isFinite(p.z)) continue;
      const outside = p.value < p.lower - 1e-9 || p.value > p.upper + 1e-9;
      assert.equal(outside, p.severity === 'anomalia', `${sensitivity} @${p.index - START}`);
    }
  }
});
