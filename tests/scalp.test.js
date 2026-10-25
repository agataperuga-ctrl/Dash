const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../scalping/js/scalp.js');

const STOCK = { multiplier: 1, tick: 0.01, qtyStep: 1, feePct: 0, feePerUnit: 0, feeMin: 0, leverage: 1 };
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('bez prowizji: wielkość = budżet ryzyka / odległość stopu', () => {
  const r = S.sizePosition({ capital: 20000, riskPct: 0.5, side: 'long', entry: 50, stop: 49.5, targetR: 2 }, STOCK);
  assert.ok(r.ok);
  assert.equal(r.qty, 200); // 100 PLN / 0,50
  assert.equal(r.limitedBy, 'ryzyko');
  close(r.lossAtStop, 100);
  close(r.target, 51);
  close(r.rrNet, 2);
  close(r.stopTicks, 50);
  close(r.breakEven, 50);
});

test('short: stop powyżej wejścia, TP poniżej', () => {
  const r = S.sizePosition({ capital: 20000, riskPct: 0.5, side: 'short', entry: 50, stop: 50.4, targetR: 1.5 }, STOCK);
  assert.ok(r.ok);
  assert.equal(r.qty, 250); // 100 PLN / 0,40
  assert.equal(r.limitedBy, 'ryzyko');
  close(r.target, 49.4);
  const bad = S.sizePosition({ capital: 10000, riskPct: 1, side: 'short', entry: 50, stop: 49 }, STOCK);
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /powyżej/);
});

test('prowizje, a nie kapitał, ograniczają wielkość, gdy obcinają ją bardziej', () => {
  const inst = { ...STOCK, feePct: 0.39, feeMin: 5 };
  // kapitał pozwala na 200 akcji, ryzyko bez prowizji na 250, z prowizjami znacznie mniej
  const r = S.sizePosition({ capital: 10000, riskPct: 0.5, side: 'long', entry: 50, stop: 49.8 }, inst);
  assert.ok(r.qty < 200);
  assert.equal(r.limitedBy, 'ryzyko');
  assert.ok(!r.warnings.some((w) => /kapitałem/.test(w)));
});

test('prowizje wliczają się w ryzyko — strata na stopie nie przekracza budżetu', () => {
  const inst = { ...STOCK, feePct: 0.39, feeMin: 5 };
  const r = S.sizePosition({ capital: 20000, riskPct: 0.5, side: 'long', entry: 40, stop: 39.8 }, inst);
  assert.ok(r.ok);
  assert.ok(r.lossAtStop <= 100 + 1e-9);
  // o jedną akcję więcej przekroczyłoby budżet
  const more = -S.tradePnl({ side: 'long', entry: 40, exit: 39.8, qty: r.qty + 1 }, inst).net;
  assert.ok(more > 100);
  assert.ok(r.qty < 500); // bez prowizji byłoby 500
  assert.equal(r.limitedBy, 'ryzyko');
});

test('minimalna prowizja jest stosowana za każdą stronę', () => {
  const inst = { ...STOCK, feePct: 0.39, feeMin: 5 };
  close(S.feeForSide(10, 10, inst), 5);
  close(S.feeForSide(100, 100, inst), 39);
  close(S.tradePnl({ side: 'long', entry: 10, exit: 11, qty: 10 }, inst).net, 10 - 10);
});

test('próg rentowności pokrywa prowizje w obie strony', () => {
  const inst = { ...STOCK, feePct: 0.1 };
  const be = S.breakEvenPrice('long', 100, 10, inst);
  close(S.tradePnl({ side: 'long', entry: 100, exit: be, qty: 10 }, inst).net, 0, 1e-6);
  assert.ok(be > 100);
  const beShort = S.breakEvenPrice('short', 100, 10, inst);
  close(S.tradePnl({ side: 'short', entry: 100, exit: beShort, qty: 10 }, inst).net, 0, 1e-6);
  assert.ok(beShort < 100);
});

test('kontrakty: mnożnik i prowizja za kontrakt', () => {
  const fw20 = { multiplier: 20, tick: 1, qtyStep: 1, feePct: 0, feePerUnit: 9, feeMin: 0, leverage: 10 };
  const r = S.sizePosition({ capital: 50000, riskPct: 1, side: 'long', entry: 2500, stop: 2490 }, fw20);
  // strata na 1 kontrakt: 10 pkt × 20 + 2 × 9 = 218; budżet 500 → 2 kontrakty
  assert.equal(r.qty, 2);
  close(r.lossAtStop, 436);
  close(r.breakEven, 2500 + 18 / 20);
  assert.equal(r.breakEvenTick, 2501);
  assert.equal(r.breakEvenTicks, 1);
});

test('ułamkowy krok wielkości (krypto) bez błędów zaokrągleń', () => {
  const crypto = { multiplier: 1, tick: 0.01, qtyStep: 0.001, feePct: 0, feePerUnit: 0, feeMin: 0, leverage: 1 };
  const r = S.sizePosition({ capital: 5000, riskPct: 1, side: 'long', entry: 60000, stop: 59700 }, crypto);
  assert.equal(r.qty, 0.083); // kapitał: 5000 / 60000 = 0,0833; ryzyko pozwalałoby na 50 / 300 = 0,166
  assert.equal(r.limitedBy, 'kapitał');
});

test('ograniczenie kapitałem i dźwignią', () => {
  const r = S.sizePosition({ capital: 1000, riskPct: 2, side: 'long', entry: 100, stop: 99.9 }, STOCK);
  assert.equal(r.qty, 10); // ryzyko pozwala na 200, kapitał na 10
  assert.equal(r.limitedBy, 'kapitał');
  const lev = S.sizePosition({ capital: 1000, riskPct: 2, side: 'long', entry: 100, stop: 99.9 }, { ...STOCK, leverage: 5 });
  assert.equal(lev.qty, 50);
});

test('dzienny limit straty obcina budżet, a wyczerpany blokuje wejście', () => {
  const r = S.sizePosition({ capital: 10000, riskPct: 1, side: 'long', entry: 50, stop: 49.5, dailyRemaining: 40 }, STOCK);
  assert.equal(r.qty, 80);
  assert.equal(r.limitedBy, 'limit dzienny');
  const none = S.sizePosition({ capital: 10000, riskPct: 1, side: 'long', entry: 50, stop: 49.5, dailyRemaining: -5 }, STOCK);
  assert.equal(none.ok, false);
  assert.match(none.errors[0], /limit straty/);
});

test('ostrzeżenie, gdy TP nie pokrywa prowizji', () => {
  const inst = { ...STOCK, feeMin: 20 };
  const r = S.sizePosition({ capital: 10000, riskPct: 1, side: 'long', entry: 50, stop: 49.5, target: 50.05 }, inst);
  assert.ok(r.ok);
  assert.ok(r.profitAtTarget < 0);
  assert.ok(r.warnings.some((w) => /nie pokrywa/.test(w)));
});

test('roundToTick i decimalsOf', () => {
  assert.equal(S.decimalsOf(0.001), 3);
  assert.equal(S.decimalsOf(1e-7), 7);
  assert.equal(S.roundToTick(2500.4, 1, 'up'), 2501);
  assert.equal(S.roundToTick(0.30000000000000004, 0.1), 0.3);
  assert.ok(S.onTick(1.23, 0.01));
  assert.ok(!S.onTick(1.235, 0.01));
});

const T = (h, net, extra = {}) => ({ time: `2026-10-25T${String(h).padStart(2, '0')}:00:00`, net, fees: 1, risk: 50, side: 'long', entry: 1, exit: 1, qty: 1, ...extra });

test('statystyki dziennika', () => {
  const s = S.journalStats([T(9, 100), T(10, -50), T(11, -50), T(12, 25)]);
  assert.equal(s.count, 4);
  assert.equal(s.winRate, 0.5);
  close(s.net, 25);
  close(s.profitFactor, 1.25);
  close(s.avgR, 0.125);
  close(s.maxDrawdown, 100);
  assert.equal(s.lossStreak, 0);
  assert.equal(S.journalStats([T(9, 10)]).profitFactor, Infinity);
});

test('strażnik ryzyka: stop po serii strat i po przekroczeniu limitu', () => {
  const limits = { maxDailyLossPct: 2, maxTrades: 10, maxLossStreak: 3 };
  const g1 = S.riskGuard([T(9, 50), T(10, -30), T(11, -30)], limits, 10000);
  assert.equal(g1.status, 'uwaga'); // 2 straty z rzędu przy limicie 3
  close(g1.remaining, 190); // limit 200, dzienny wynik −10
  const g2 = S.riskGuard([T(9, -30), T(10, -30), T(11, -30)], limits, 10000);
  assert.equal(g2.status, 'stop');
  const g3 = S.riskGuard([T(9, -250)], limits, 10000);
  assert.equal(g3.checks.find((c) => c.key === 'loss').status, 'stop');
  assert.ok(g3.remaining < 0);
  assert.equal(S.riskGuard([], { maxDailyLossPct: 0 }, 10000).remaining, Infinity);
});

test('CSV dziennika: eksport i import w obie strony', () => {
  const trades = [
    { id: 'a', time: '2026-10-25T09:15:00.000Z', symbol: 'PKN', side: 'short', entry: 60.5, exit: 60.1, qty: 100, stop: 60.8, fees: 4.5, net: 35.5, risk: 34.5, note: 'wybicie; "szybko"' },
  ];
  const csv = S.toCsv(trades);
  assert.match(csv, /60,5/);
  const back = S.fromCsv(csv);
  assert.deepEqual(back.errors, []);
  const t = back.trades[0];
  assert.equal(t.side, 'short');
  assert.equal(t.entry, 60.5);
  assert.equal(t.net, 35.5);
  assert.equal(t.note, 'wybicie; "szybko"');
  assert.match(S.fromCsv('a;b\n1;2').errors[0], /Brak kolumn/);
});
