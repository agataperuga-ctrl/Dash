/*
 * Obliczenia dla scalpingu: wielkość pozycji, prowizje, próg rentowności,
 * statystyki dziennika i strażnik ryzyka dnia.
 *
 * Instrument:
 *   multiplier  — wartość 1 punktu ceny na 1 jednostkę (akcje: 1, FW20: 20, forex 1 lot: 100000)
 *   tick        — minimalny krok ceny
 *   qtyStep     — krok wielkości pozycji (akcje: 1, krypto: 0.0001, forex: 0.01 lota)
 *   feePct      — prowizja w % wartości transakcji, za każdą stronę (wejście i wyjście osobno)
 *   feePerUnit  — prowizja stała za jednostkę (np. za kontrakt), za każdą stronę
 *   feeMin      — minimalna prowizja za zlecenie (stronę)
 *   leverage    — maks. dźwignia (1 = bez dźwigni); ogranicza wartość pozycji do kapitał × dźwignia
 *
 * Prowizja za stronę = max(feePct% · wartość + feePerUnit · ilość, feeMin).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Scalp = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-9;

  function dirOf(side) {
    return side === 'short' ? -1 : 1;
  }

  function decimalsOf(step) {
    if (!Number.isFinite(step) || step <= 0) return 0;
    const s = String(step);
    if (s.includes('e-')) return +s.split('e-')[1];
    return s.includes('.') ? s.split('.')[1].length : 0;
  }

  function roundTo(x, decimals) {
    const f = 10 ** decimals;
    return Math.round(x * f) / f;
  }

  // Czy cena leży na siatce kroku ceny (z tolerancją na błędy zmiennoprzecinkowe).
  function onTick(price, tick) {
    if (!(tick > 0)) return true;
    const n = price / tick;
    return Math.abs(n - Math.round(n)) < 1e-6;
  }

  function roundToTick(price, tick, mode = 'nearest') {
    if (!(tick > 0)) return price;
    const n = price / tick;
    const k = mode === 'up' ? Math.ceil(n - 1e-6) : mode === 'down' ? Math.floor(n + 1e-6) : Math.round(n);
    return roundTo(k * tick, decimalsOf(tick));
  }

  function feeForSide(price, qty, inst) {
    if (!(qty > 0)) return 0;
    const value = Math.abs(price) * qty * inst.multiplier;
    const fee = ((inst.feePct || 0) / 100) * value + (inst.feePerUnit || 0) * qty;
    return Math.max(fee, inst.feeMin || 0);
  }

  // Wynik transakcji zamkniętej po cenie exit.
  function tradePnl({ side, entry, exit, qty }, inst) {
    const gross = dirOf(side) * (exit - entry) * qty * inst.multiplier;
    const fees = feeForSide(entry, qty, inst) + feeForSide(exit, qty, inst);
    return { gross, fees, net: gross - fees };
  }

  // Cena wyjścia, przy której wynik netto (po prowizjach w obie strony) = 0.
  function breakEvenPrice(side, entry, qty, inst) {
    if (!(qty > 0)) return NaN;
    const dir = dirOf(side);
    const net = (d) => tradePnl({ side, entry, exit: entry + dir * d, qty }, inst).net;
    if (net(0) >= 0) return entry;
    let hi = Math.max(inst.tick || 0, Math.abs(entry) * 1e-4, 1e-9);
    let guard = 0;
    while (net(hi) < 0 && guard++ < 200) hi *= 2;
    if (net(hi) < 0) return NaN; // prowizje rosną szybciej niż zysk (feePct ≥ 100%)
    let lo = 0;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      if (net(mid) < 0) lo = mid; else hi = mid;
    }
    return entry + dir * hi;
  }

  /*
   * Wielkość pozycji tak, aby strata na stopie (z prowizjami za wejście i wyjście)
   * nie przekroczyła budżetu ryzyka, a wartość pozycji — kapitału × dźwigni.
   *
   * p: { capital, riskPct, side, entry, stop, target, targetR, dailyRemaining }
   *   target   — cena take profit (opcjonalnie)
   *   targetR  — TP jako wielokrotność ryzyka, używane gdy brak target
   *   dailyRemaining — pozostały dzienny limit straty (opcjonalnie); obcina budżet
   */
  function sizePosition(p, inst) {
    const errors = [];
    const warnings = [];
    const dir = dirOf(p.side);
    const { capital, riskPct, entry, stop } = p;

    if (!(capital > 0)) errors.push('Podaj kapitał większy od zera.');
    if (!(riskPct > 0)) errors.push('Podaj ryzyko na transakcję większe od zera.');
    if (!(entry > 0)) errors.push('Podaj cenę wejścia.');
    if (!Number.isFinite(stop)) errors.push('Podaj cenę stop loss.');
    if (!(inst.multiplier > 0)) errors.push('Mnożnik instrumentu musi być większy od zera.');
    if (!(inst.qtyStep > 0)) errors.push('Krok wielkości pozycji musi być większy od zera.');
    if (errors.length) return { ok: false, errors, warnings };

    if (stop === entry) errors.push('Stop loss nie może być równy cenie wejścia.');
    else if (dir * (entry - stop) < 0) {
      errors.push(p.side === 'short'
        ? 'Dla pozycji krótkiej stop loss musi być powyżej ceny wejścia.'
        : 'Dla pozycji długiej stop loss musi być poniżej ceny wejścia.');
    }
    if (errors.length) return { ok: false, errors, warnings };

    const stopDist = Math.abs(entry - stop);
    let target = Number.isFinite(p.target) ? p.target : NaN;
    if (!Number.isFinite(target) && p.targetR > 0) {
      target = roundToTick(entry + dir * p.targetR * stopDist, inst.tick);
    }
    if (Number.isFinite(target) && dir * (target - entry) <= 0) {
      errors.push(p.side === 'short'
        ? 'Dla pozycji krótkiej take profit musi być poniżej ceny wejścia.'
        : 'Dla pozycji długiej take profit musi być powyżej ceny wejścia.');
      return { ok: false, errors, warnings };
    }

    const riskBudget = (capital * riskPct) / 100;
    let budget = riskBudget;
    let limitedBy = 'ryzyko';
    if (Number.isFinite(p.dailyRemaining) && p.dailyRemaining < budget) {
      budget = Math.max(0, p.dailyRemaining);
      limitedBy = 'limit dzienny';
    }

    const leverage = inst.leverage > 0 ? inst.leverage : 1;
    const step = inst.qtyStep;
    const qd = decimalsOf(step);
    const qtyOf = (n) => roundTo(n * step, qd);
    const lossAt = (q) => -tradePnl({ side: p.side, entry, exit: stop, qty: q }, inst).net;

    const nByRisk = Math.floor(budget / (stopDist * inst.multiplier) / step + EPS);
    const nByCapital = Math.floor((capital * leverage) / (entry * inst.multiplier) / step + EPS);
    let hiN = Math.min(nByRisk, nByCapital);

    // Największe n, dla którego strata na stopie z prowizjami mieści się w budżecie (monotoniczne w n).
    let lo = 0;
    while (lo < hiN) {
      const mid = Math.ceil((lo + hiN) / 2);
      if (lossAt(qtyOf(mid)) <= budget + EPS) lo = mid; else hiN = mid - 1;
    }
    const qty = qtyOf(lo);
    // Kapitał ogranicza tylko wtedy, gdy to on wyznaczył wynik (prowizje mogą obciąć wielkość jeszcze bardziej).
    if (lo === nByCapital && nByCapital < nByRisk) limitedBy = 'kapitał';

    const result = {
      ok: true, errors, warnings, side: p.side, entry, stop, target,
      qty, riskBudget, budget, limitedBy,
      stopDist, stopTicks: inst.tick > 0 ? stopDist / inst.tick : NaN,
    };

    if (!(qty > 0)) {
      result.ok = false;
      errors.push(budget <= 0
        ? 'Dzienny limit straty został wykorzystany — koniec handlu na dziś.'
        : 'Przy tym stopie i budżecie ryzyka nie da się otworzyć nawet minimalnej pozycji. Zawęź stop lub zwiększ ryzyko.');
      return result;
    }

    const loss = tradePnl({ side: p.side, entry, exit: stop, qty }, inst);
    result.positionValue = entry * qty * inst.multiplier;
    result.margin = result.positionValue / leverage;
    result.lossAtStop = -loss.net;
    result.feesAtStop = loss.fees;
    result.riskPctActual = (result.lossAtStop / capital) * 100;
    result.breakEven = breakEvenPrice(p.side, entry, qty, inst);
    result.breakEvenTick = roundToTick(result.breakEven, inst.tick, dir > 0 ? 'up' : 'down');
    result.breakEvenTicks = inst.tick > 0 ? Math.abs(result.breakEvenTick - entry) / inst.tick : NaN;

    if (Number.isFinite(target)) {
      const win = tradePnl({ side: p.side, entry, exit: target, qty }, inst);
      result.profitAtTarget = win.net;
      result.feesAtTarget = win.fees;
      result.targetTicks = inst.tick > 0 ? Math.abs(target - entry) / inst.tick : NaN;
      result.rrGross = Math.abs(target - entry) / stopDist;
      result.rrNet = result.lossAtStop > 0 ? win.net / result.lossAtStop : NaN;
      if (win.net <= 0) warnings.push('Take profit nie pokrywa prowizji — transakcja zakończona na TP da stratę.');
      else if (result.rrNet < 1) warnings.push('Stosunek zysku do ryzyka po prowizjach jest poniżej 1:1.');
    }

    const feeShare = loss.fees / result.lossAtStop;
    if (feeShare >= 0.25) {
      warnings.push(`Prowizje to ${Math.round(feeShare * 100)}% straty na stopie — stop jest bardzo ciasny względem kosztów.`);
    }
    if (!onTick(entry, inst.tick)) warnings.push('Cena wejścia nie leży na kroku ceny instrumentu.');
    if (!onTick(stop, inst.tick)) warnings.push('Stop loss nie leży na kroku ceny instrumentu.');
    if (Number.isFinite(p.target) && !onTick(p.target, inst.tick)) warnings.push('Take profit nie leży na kroku ceny instrumentu.');
    if (limitedBy === 'kapitał') warnings.push('Wielkość ograniczona kapitałem i dźwignią — ryzyko jest mniejsze niż zakładane.');
    if (limitedBy === 'limit dzienny') warnings.push('Wielkość obcięta do pozostałego dziennego limitu straty.');

    return result;
  }

  // ---------- dziennik ----------

  function localDay(iso) {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function sortByTime(trades) {
    return trades.slice().sort((a, b) => new Date(a.time) - new Date(b.time));
  }

  function trailingLosses(trades) {
    const sorted = sortByTime(trades);
    let n = 0;
    for (let i = sorted.length - 1; i >= 0 && sorted[i].net < 0; i--) n++;
    return n;
  }

  function journalStats(trades) {
    const sorted = sortByTime(trades);
    const wins = sorted.filter((t) => t.net > 0);
    const losses = sorted.filter((t) => t.net < 0);
    const sumWins = wins.reduce((s, t) => s + t.net, 0);
    const sumLosses = losses.reduce((s, t) => s + t.net, 0);
    const net = sorted.reduce((s, t) => s + t.net, 0);
    const fees = sorted.reduce((s, t) => s + (t.fees || 0), 0);
    const rs = sorted.filter((t) => t.risk > 0).map((t) => t.net / t.risk);

    let equity = 0;
    let peak = 0;
    let maxDrawdown = 0;
    for (const t of sorted) {
      equity += t.net;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak - equity);
    }

    const n = sorted.length;
    return {
      count: n,
      wins: wins.length,
      losses: losses.length,
      winRate: n ? wins.length / n : NaN,
      net,
      fees,
      avgWin: wins.length ? sumWins / wins.length : NaN,
      avgLoss: losses.length ? sumLosses / losses.length : NaN,
      profitFactor: losses.length ? sumWins / -sumLosses : wins.length ? Infinity : NaN,
      expectancy: n ? net / n : NaN,
      avgR: rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : NaN,
      maxDrawdown,
      lossStreak: trailingLosses(sorted),
    };
  }

  /*
   * Strażnik ryzyka dnia. limits: { maxDailyLossPct, maxTrades, maxLossStreak } — 0 lub brak = wyłączony.
   * Zwraca stan każdej reguły (ok / uwaga / stop) i pozostały limit straty.
   */
  function riskGuard(todayTrades, limits, capital) {
    const stats = journalStats(todayTrades);
    const checks = [];
    let remaining = Infinity;

    const level = (ratio, warnAt) => (ratio >= 1 ? 'stop' : ratio >= warnAt ? 'uwaga' : 'ok');

    if (limits.maxDailyLossPct > 0 && capital > 0) {
      const limit = (capital * limits.maxDailyLossPct) / 100;
      const used = Math.max(0, -stats.net);
      remaining = limit - used;
      checks.push({ key: 'loss', label: 'Dzienna strata', used, limit, ratio: used / limit, status: level(used / limit, 0.75) });
    }
    if (limits.maxTrades > 0) {
      const used = stats.count;
      const limit = limits.maxTrades;
      checks.push({ key: 'trades', label: 'Liczba transakcji', used, limit, ratio: used / limit, status: level(used / limit, 0.8) });
    }
    if (limits.maxLossStreak > 0) {
      const used = stats.lossStreak;
      const limit = limits.maxLossStreak;
      const status = used >= limit ? 'stop' : used === limit - 1 && used > 0 ? 'uwaga' : 'ok';
      checks.push({ key: 'streak', label: 'Straty z rzędu', used, limit, ratio: used / limit, status });
    }

    const status = checks.some((c) => c.status === 'stop') ? 'stop'
      : checks.some((c) => c.status === 'uwaga') ? 'uwaga' : 'ok';
    return { status, checks, remaining, stats };
  }

  // ---------- CSV dziennika ----------

  const CSV_COLUMNS = ['czas', 'symbol', 'kierunek', 'wejscie', 'wyjscie', 'ilosc', 'stop', 'prowizje', 'wynik', 'ryzyko', 'notatka'];

  function csvField(v) {
    const s = v == null ? '' : String(v);
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function csvNum(x) {
    return Number.isFinite(x) ? String(roundTo(x, 10)).replace('.', ',') : '';
  }

  function toCsv(trades) {
    const rows = sortByTime(trades).map((t) => [
      t.time, t.symbol, t.side, csvNum(t.entry), csvNum(t.exit), csvNum(t.qty), csvNum(t.stop),
      csvNum(t.fees), csvNum(t.net), csvNum(t.risk), t.note,
    ].map(csvField).join(';'));
    return [CSV_COLUMNS.join(';'), ...rows].join('\r\n') + '\r\n';
  }

  function splitCsv(text) {
    const delimiter = (text.split(/\r?\n/)[0] || '').includes(';') ? ';' : ',';
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

  function parseNum(s) {
    const t = String(s == null ? '' : s).trim().replace(/\s/g, '').replace(',', '.');
    return t === '' ? NaN : Number(t);
  }

  function fromCsv(text) {
    const rows = splitCsv(text.replace(/^﻿/, ''));
    if (!rows.length) return { trades: [], errors: ['Plik jest pusty.'] };
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = Object.fromEntries(CSV_COLUMNS.map((c) => [c, header.indexOf(c)]));
    const missing = ['czas', 'kierunek', 'wejscie', 'wyjscie', 'ilosc', 'wynik'].filter((c) => idx[c] < 0);
    if (missing.length) return { trades: [], errors: [`Brak kolumn: ${missing.join(', ')}.`] };

    const trades = [];
    const errors = [];
    rows.slice(1).forEach((r, i) => {
      const get = (c) => (idx[c] >= 0 ? r[idx[c]] : '');
      const t = {
        id: `imp-${Date.now()}-${i}`,
        time: get('czas').trim(),
        symbol: get('symbol').trim(),
        side: get('kierunek').trim().toLowerCase() === 'short' ? 'short' : 'long',
        entry: parseNum(get('wejscie')),
        exit: parseNum(get('wyjscie')),
        qty: parseNum(get('ilosc')),
        stop: parseNum(get('stop')),
        fees: parseNum(get('prowizje')) || 0,
        net: parseNum(get('wynik')),
        risk: parseNum(get('ryzyko')),
        note: get('notatka'),
      };
      if (Number.isNaN(new Date(t.time).getTime()) || !Number.isFinite(t.net)) errors.push(`Wiersz ${i + 2}: nieprawidłowy czas lub wynik — pominięty.`);
      else trades.push(t);
    });
    return { trades, errors };
  }

  return {
    dirOf, decimalsOf, onTick, roundToTick, feeForSide, tradePnl, breakEvenPrice, sizePosition,
    localDay, journalStats, riskGuard, toCsv, fromCsv, parseNum,
  };
});
