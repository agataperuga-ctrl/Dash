/*
 * Świece 5-minutowe z API Capital.com (GET /api/v1/prices/{epic}?resolution=MINUTE_5).
 *
 * Odpowiedź API: { prices: [{ snapshotTime, snapshotTimeUTC, openPrice: {bid, ask}, closePrice, highPrice,
 * lowPrice, lastTradedVolume }] }. Czas UTC bywa podany bez strefy ("2026-10-26T14:05:00"), więc doklejamy "Z".
 * Świeca w pamięci: { t: ms UTC początku świecy, bid: [o,h,l,c], ask: [o,h,l,c], v }.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Market = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FIVE_MIN = 5 * 60 * 1000;

  function parseUtc(s) {
    if (typeof s !== 'string' || !s) return NaN;
    const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z';
    return Date.parse(iso);
  }

  function side(p, key) {
    const x = p && p[key];
    return x == null ? NaN : Number(x);
  }

  // Zamienia odpowiedź API na świece; zgłasza błąd, gdy format jest inny niż oczekiwany.
  function parsePrices(json) {
    if (!json || !Array.isArray(json.prices)) {
      throw new Error('Odpowiedź API nie zawiera listy "prices".');
    }
    const candles = [];
    for (const p of json.prices) {
      const t = parseUtc(p.snapshotTimeUTC);
      const ohlc = (key) => [p.openPrice, p.highPrice, p.lowPrice, p.closePrice].map((x) => side(x, key));
      const bid = ohlc('bid');
      const ask = ohlc('ask');
      if (!Number.isFinite(t) || !bid.every(Number.isFinite)) continue;
      candles.push({ t, bid, ask: ask.every(Number.isFinite) ? ask : bid.slice(), v: Number(p.lastTradedVolume) || 0 });
    }
    if (json.prices.length && !candles.length) {
      throw new Error('Nie rozpoznano formatu świec (brak snapshotTimeUTC lub cen bid).');
    }
    return candles;
  }

  // Łączy świece po czasie; nowsze dane nadpisują starsze (ostatnia świeca dorasta). Zostawia `limit` najnowszych.
  function mergeCandles(oldCandles, newCandles, limit = 3000) {
    const byTime = new Map();
    for (const c of oldCandles || []) byTime.set(c.t, c);
    for (const c of newCandles || []) byTime.set(c.t, c);
    const all = Array.from(byTime.values()).sort((a, b) => a.t - b.t);
    return all.slice(Math.max(0, all.length - limit));
  }

  // Najbliższy moment pobrania: zamknięcie kolejnej świecy + opóźnienie (serwer potrzebuje chwili na domknięcie).
  function nextFetchAt(now, delayMs = 10000) {
    return (Math.floor((now - delayMs) / FIVE_MIN) + 1) * FIVE_MIN + delayMs;
  }

  const isComplete = (c, now) => c.t + FIVE_MIN <= now;

  function localDayStart(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  // Podsumowanie do kafelków: ostatnia cena, spread, zmiana do poprzedniej świecy i od początku dnia (czas lokalny).
  function summarize(candles, now) {
    if (!candles || !candles.length) return null;
    const last = candles[candles.length - 1];
    const prev = candles.length > 1 ? candles[candles.length - 2] : null;
    const dayStart = localDayStart(last.t);
    const today = candles.filter((c) => c.t >= dayStart);
    const bidClose = last.bid[3];
    const askClose = last.ask[3];
    return {
      time: last.t,
      complete: isComplete(last, now),
      bid: bidClose,
      ask: askClose,
      spread: askClose - bidClose,
      changePrev: prev ? bidClose - prev.bid[3] : NaN,
      dayOpen: today[0].bid[0],
      changeDay: bidClose - today[0].bid[0],
      dayHigh: Math.max(...today.map((c) => c.bid[1])),
      dayLow: Math.min(...today.map((c) => c.bid[2])),
      candleRange: last.bid[1] - last.bid[2],
      // średni zakres świecy z ostatnich 12 zamkniętych (1 godzina) — orientacyjna zmienność do ustawiania stopu
      avgRange: (() => {
        const closed = candles.filter((c) => isComplete(c, now)).slice(-12);
        return closed.length ? closed.reduce((s, c) => s + c.bid[1] - c.bid[2], 0) / closed.length : NaN;
      })(),
    };
  }

  return { FIVE_MIN, parseUtc, parsePrices, mergeCandles, nextFetchAt, isComplete, summarize };
});
