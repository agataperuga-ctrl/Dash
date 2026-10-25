const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../scalping/js/market.js');

const price = (bid, ask) => ({ bid, ask });
const apiCandle = (time, o, h, l, c, spread = 1) => ({
  snapshotTime: time, snapshotTimeUTC: time,
  openPrice: price(o, o + spread), highPrice: price(h, h + spread), lowPrice: price(l, l + spread), closePrice: price(c, c + spread),
  lastTradedVolume: 10,
});
const T0 = Date.UTC(2026, 9, 26, 14, 0);

test('parsePrices: czas UTC bez strefy, bid/ask jako OHLC', () => {
  const candles = M.parsePrices({ prices: [apiCandle('2026-10-26T14:00:00', 100, 105, 99, 104), apiCandle('2026-10-26T14:05:00', 104, 106, 103, 103.5)] });
  assert.equal(candles.length, 2);
  assert.equal(candles[0].t, T0);
  assert.deepEqual(candles[0].bid, [100, 105, 99, 104]);
  assert.deepEqual(candles[1].ask, [105, 107, 104, 104.5]);
});

test('parsePrices zgłasza nieznany format zamiast zwracać puste dane', () => {
  assert.throws(() => M.parsePrices({ errorCode: 'error.invalid.session' }), /prices/);
  assert.throws(() => M.parsePrices({ prices: [{ time: 'x', close: 1 }] }), /formatu/);
  assert.deepEqual(M.parsePrices({ prices: [] }), []);
});

test('mergeCandles nadpisuje świecę w trakcie i ogranicza historię', () => {
  const a = [{ t: 1, bid: [1, 1, 1, 1] }, { t: 2, bid: [2, 2, 2, 2] }];
  const b = [{ t: 2, bid: [2, 3, 2, 3] }, { t: 3, bid: [3, 3, 3, 3] }];
  const m = M.mergeCandles(a, b, 2);
  assert.deepEqual(m.map((c) => c.t), [2, 3]);
  assert.equal(m[0].bid[3], 3);
});

test('nextFetchAt: 10 s po zamknięciu kolejnej świecy', () => {
  assert.equal(M.nextFetchAt(T0 + 3 * 60e3), T0 + 5 * 60e3 + 10e3);
  assert.equal(M.nextFetchAt(T0 + 5 * 60e3 + 5e3), T0 + 5 * 60e3 + 10e3);
  assert.equal(M.nextFetchAt(T0 + 5 * 60e3 + 10e3), T0 + 10 * 60e3 + 10e3);
});

test('summarize: zmiana do poprzedniej świecy, spread, świeca w trakcie', () => {
  const candles = M.parsePrices({ prices: [apiCandle('2026-10-26T14:00:00', 100, 105, 99, 104), apiCandle('2026-10-26T14:05:00', 104, 106, 103, 103.5, 1.5)] });
  const s = M.summarize(candles, T0 + 7 * 60e3);
  assert.equal(s.bid, 103.5);
  assert.equal(s.spread, 1.5);
  assert.equal(s.changePrev, -0.5);
  assert.equal(s.complete, false);
  assert.equal(s.avgRange, 6); // tylko zamknięta świeca 14:00
  assert.equal(M.summarize([], 0), null);
});
