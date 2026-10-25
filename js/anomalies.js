/*
 * Wykrywanie anomalii w kwartalnych szeregach wskaźników.
 *
 * Metoda (na każdy wskaźnik osobno):
 *  1. Sezonowość: klasyczna dekompozycja — średnia ruchoma centrowana 2x4,
 *     indeks sezonowy kwartału = mediana ilorazów (lub różnic) wartość/średnia.
 *     Model multiplikatywny, gdy wszystkie wartości > 0, w przeciwnym razie addytywny.
 *  2. Wartość oczekiwana: lokalny trend Theila–Sena dopasowany do 6 najbliższych
 *     kwartałów (bez badanego) na szeregu oczyszczonym z sezonowości,
 *     przywrócona sezonowość. Ostatni kwartał jest więc oceniany tylko na danych z przeszłości.
 *  3. Odchylenie: reszta = wartość/oczekiwana − 1 (lub różnica w modelu addytywnym),
 *     zmodyfikowany z-score Iglewicza–Hoaglina: 0.6745·(r − mediana)/MAD.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Anomalies = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAD_SCALE = 0.6745;
  const NEIGHBOURS = 6;
  const MIN_POINTS = 8;

  const SENSITIVITY = {
    niska: { anomaly: 4.5, watch: 3.5 },
    standardowa: { anomaly: 3.5, watch: 2.5 },
    wysoka: { anomaly: 3.0, watch: 2.0 },
  };

  function median(xs) {
    const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
    const n = s.length;
    if (!n) return NaN;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  // "2024-Q1", "2024 Q1", "Q1 2024", "Q1-2024", "2024Q1", "I kw. 2024" -> indeks kwartału
  function parseQuarter(label) {
    const s = String(label).trim().toUpperCase();
    let m = s.match(/^(\d{4})\s*[-/ ]?\s*Q([1-4])$/) || null;
    if (m) return toIndex(+m[1], +m[2]);
    m = s.match(/^Q([1-4])\s*[-/ ]?\s*(\d{4})$/);
    if (m) return toIndex(+m[2], +m[1]);
    m = s.match(/^(IV|III|II|I)\s*(?:KW\.?|KWARTAŁ)?\s*(\d{4})$/);
    if (m) return toIndex(+m[2], { I: 1, II: 2, III: 3, IV: 4 }[m[1]]);
    return null;
  }

  function toIndex(year, q) {
    return year * 4 + (q - 1);
  }

  function quarterLabel(index) {
    return Math.floor(index / 4) + '-Q' + ((index % 4) + 1);
  }

  function seasonalIndices(values, startIndex, model) {
    const identity = model === 'mult' ? 1 : 0;
    const flat = [identity, identity, identity, identity];
    if (values.filter(Number.isFinite).length < MIN_POINTS) return flat;

    const byQuarter = [[], [], [], []];
    for (let t = 2; t < values.length - 2; t++) {
      const w = values.slice(t - 2, t + 3);
      if (!w.every(Number.isFinite)) continue;
      const cma = (0.5 * w[0] + w[1] + w[2] + w[3] + 0.5 * w[4]) / 4;
      const q = (startIndex + t) % 4;
      if (model === 'mult') {
        if (cma > 0) byQuarter[q].push(values[t] / cma);
      } else {
        byQuarter[q].push(values[t] - cma);
      }
    }
    if (byQuarter.some((r) => r.length === 0)) return flat;

    const raw = byQuarter.map(median);
    const mean = raw.reduce((a, b) => a + b, 0) / 4;
    return model === 'mult' ? raw.map((s) => s / mean) : raw.map((s) => s - mean);
  }

  // Theil–Sen: prosta przez punkty (x, y), przewidywanie w x0
  function theilSen(points, x0) {
    const slopes = [];
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        slopes.push((points[j][1] - points[i][1]) / (points[j][0] - points[i][0]));
      }
    }
    const slope = median(slopes);
    const intercept = median(points.map(([x, y]) => y - slope * x));
    return intercept + slope * x0;
  }

  function nearestNeighbours(deseason, t) {
    const out = [];
    for (let dist = 1; out.length < NEIGHBOURS && (t - dist >= 0 || t + dist < deseason.length); dist++) {
      for (const j of [t - dist, t + dist]) {
        if (j >= 0 && j < deseason.length && Number.isFinite(deseason[j]) && out.length < NEIGHBOURS) {
          out.push([j, deseason[j]]);
        }
      }
    }
    return out;
  }

  function fitResiduals(vals, deseason, sAt, model, masked) {
    const n = vals.length;
    const usable = deseason.map((d, j) => (masked.has(j) ? NaN : d));
    const expected = new Array(n).fill(NaN);
    const residual = new Array(n).fill(NaN);
    for (let t = 0; t < n; t++) {
      if (!Number.isFinite(vals[t])) continue;
      const nb = nearestNeighbours(usable, t);
      if (nb.length < 4) continue;
      const trend = theilSen(nb, t);
      if (model === 'mult') {
        if (!(trend > 0)) continue;
        expected[t] = trend * sAt(t);
        residual[t] = vals[t] / expected[t] - 1;
      } else {
        expected[t] = trend + sAt(t);
        residual[t] = vals[t] - expected[t];
      }
    }
    return { expected, residual };
  }

  function robustStats(residual) {
    const center = median(residual);
    let spread = median(residual.map((r) => Math.abs(r - center))) / MAD_SCALE;
    if (!(spread > 1e-12)) {
      // MAD = 0 (ponad połowa reszt identyczna): średnie odchylenie bezwzględne · √(π/2)
      const dev = residual.filter(Number.isFinite).map((r) => Math.abs(r - center));
      spread = dev.length ? (dev.reduce((a, b) => a + b, 0) / dev.length) * 1.2533 : 0;
    }
    return { center, spread };
  }

  /*
   * values: tablica wartości na ciągłej osi kwartałów (null = brak danych),
   * startIndex: indeks kwartału values[0],
   * opts.sensitivity: klucz SENSITIVITY.
   */
  function detect(values, startIndex, opts) {
    const thr = SENSITIVITY[(opts && opts.sensitivity) || 'standardowa'] || SENSITIVITY.standardowa;
    const vals = values.map((v) => (Number.isFinite(v) ? v : NaN));
    const finite = vals.filter(Number.isFinite);
    const model = finite.length && finite.every((v) => v > 0) ? 'mult' : 'add';
    const n = vals.length;

    const empty = vals.map((v, t) => ({
      index: startIndex + t, value: v, expected: NaN, lower: NaN, upper: NaN,
      residual: NaN, z: NaN, severity: 'brak',
    }));
    if (finite.length < MIN_POINTS) return { model, enough: false, points: empty };

    const seas = seasonalIndices(vals, startIndex, model);
    const sAt = (t) => seas[(startIndex + t) % 4];
    const deseason = vals.map((v, t) => (model === 'mult' ? v / sAt(t) : v - sAt(t)));

    // Przebieg 2 powtarza dopasowanie bez anomalii z przebiegu 1, żeby silny
    // skok nie przesuwał trendu oczekiwanego dla sąsiednich kwartałów.
    let fit = fitResiduals(vals, deseason, sAt, model, new Set());
    let stats = robustStats(fit.residual);
    const masked = new Set();
    fit.residual.forEach((r, t) => {
      if (stats.spread > 1e-12 && Math.abs((r - stats.center) / stats.spread) >= thr.anomaly) masked.add(t);
    });
    if (masked.size) {
      fit = fitResiduals(vals, deseason, sAt, model, masked);
      stats = robustStats(fit.residual);
    }
    const { expected, residual } = fit;
    const { center, spread } = stats;

    const bound = (t, k) => {
      const r = center + k * spread;
      return model === 'mult' ? expected[t] * (1 + r) : expected[t] + r;
    };

    const points = vals.map((v, t) => {
      const z = spread > 1e-12 && Number.isFinite(residual[t]) ? (residual[t] - center) / spread : NaN;
      let severity = 'brak';
      if (Number.isFinite(z)) {
        severity = Math.abs(z) >= thr.anomaly ? 'anomalia' : Math.abs(z) >= thr.watch ? 'obserwacja' : 'norma';
      }
      return {
        index: startIndex + t,
        value: v,
        expected: expected[t],
        lower: bound(t, -thr.anomaly),
        upper: bound(t, thr.anomaly),
        residual: residual[t],
        z,
        severity,
      };
    });
    return { model, enough: true, seasonal: seas, points };
  }

  return { detect, parseQuarter, quarterLabel, toIndex, median, SENSITIVITY };
});
