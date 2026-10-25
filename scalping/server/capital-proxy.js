#!/usr/bin/env node
/*
 * Pośrednik Capital.com -> Pulpit scalpera.
 *
 * Co 5 minut (po zamknięciu świecy) pobiera świece MINUTE_5 instrumentu z API Capital.com,
 * zapisuje je w scalping/dane/ i udostępnia aplikację pod http://127.0.0.1:8787
 * razem z danymi pod /api/rynek. Klucz API i hasło zostają na tym komputerze.
 *
 * Konfiguracja: zmienne środowiskowe albo plik scalping/server/.env (wzór: .env.przyklad):
 *   CAPITAL_API_KEY, CAPITAL_IDENTIFIER (login/e-mail), CAPITAL_PASSWORD (hasło klucza API),
 *   CAPITAL_DEMO=1 (konto demo), CAPITAL_EPIC=US100, PORT=8787
 *
 * Uruchomienie:  node scalping/server/capital-proxy.js
 * Dostęp z telefonu: DOSTEP_Z_SIECI=1 (adresy do wpisania w telefonie pojawią się po starcie).
 * Diagnostyka:   node scalping/server/capital-proxy.js --szukaj "US Tech"   (lista epiców)
 *                node scalping/server/capital-proxy.js --sprawdz           (surowa ostatnia świeca)
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Market = require('../js/market.js');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'dane');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadEnvFile(path.join(__dirname, '.env'));

const CONFIG = {
  apiKey: process.env.CAPITAL_API_KEY,
  identifier: process.env.CAPITAL_IDENTIFIER,
  password: process.env.CAPITAL_PASSWORD,
  demo: /^(1|true|tak)$/i.test(process.env.CAPITAL_DEMO || ''),
  epic: process.env.CAPITAL_EPIC || 'US100',
  port: Number(process.env.PORT) || 8787,
  // DOSTEP_Z_SIECI=1: aplikacja dostępna też z telefonu w tej samej sieci (np. domowe Wi-Fi, Tailscale).
  lan: /^(1|true|tak)$/i.test(process.env.DOSTEP_Z_SIECI || ''),
};
// CAPITAL_BASE_URL służy tylko do testów z atrapą API.
const BASE_URL = process.env.CAPITAL_BASE_URL || (CONFIG.demo
  ? 'https://demo-api-capital.backend-capital.com/api/v1'
  : 'https://api-capital.backend-capital.com/api/v1');
const DATA_FILE = path.join(DATA_DIR, `${CONFIG.epic.replace(/[^\w.-]/g, '_')}-5m.json`);

const log = (...a) => console.log(new Date().toLocaleTimeString('pl-PL'), ...a);

// ---------- API Capital.com ----------

let session = null; // { cst, token }

async function login() {
  const res = await fetch(`${BASE_URL}/session`, {
    method: 'POST',
    headers: { 'X-CAP-API-KEY': CONFIG.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: CONFIG.identifier, password: CONFIG.password, encryptedPassword: false }),
  });
  if (!res.ok) throw new Error(`Logowanie nieudane (HTTP ${res.status}): ${await res.text()}`);
  session = { cst: res.headers.get('CST'), token: res.headers.get('X-SECURITY-TOKEN') };
  if (!session.cst || !session.token) throw new Error('Logowanie: brak nagłówków CST / X-SECURITY-TOKEN w odpowiedzi.');
  log(`Zalogowano (${CONFIG.demo ? 'demo' : 'konto rzeczywiste'}).`);
}

// GET z sesją; po 401 (sesja wygasa po 10 min bezczynności) loguje się ponownie i powtarza raz.
async function apiGet(pathAndQuery) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!session) await login();
    const res = await fetch(`${BASE_URL}${pathAndQuery}`, {
      headers: { CST: session.cst, 'X-SECURITY-TOKEN': session.token },
    });
    if (res.status === 401 && attempt === 0) { session = null; continue; }
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} dla ${pathAndQuery}: ${text}`);
    return JSON.parse(text);
  }
  throw new Error('Nie udało się odnowić sesji.');
}

const pricesPath = (max) => `/prices/${encodeURIComponent(CONFIG.epic)}?resolution=MINUTE_5&max=${max}`;

// ---------- stan i zapis ----------

const state = { epic: CONFIG.epic, resolution: 'MINUTE_5', demo: CONFIG.demo, candles: [], updatedAt: null, lastError: null, nextFetchAt: null };

function loadStore() {
  try {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(saved.candles)) state.candles = saved.candles;
    state.updatedAt = saved.updatedAt || null;
    log(`Wczytano ${state.candles.length} zapisanych świec z ${path.relative(process.cwd(), DATA_FILE)}.`);
  } catch (e) { /* pierwszy start */ }
}

function saveStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ epic: state.epic, updatedAt: state.updatedAt, candles: state.candles }));
  fs.renameSync(tmp, DATA_FILE);
}

async function refresh() {
  try {
    // Pierwsze pobranie: ostatnie ~3,5 dnia; potem 24 świece (2 h) z zapasem na przerwy w działaniu.
    const max = state.candles.length ? 24 : 1000;
    const fresh = Market.parsePrices(await apiGet(pricesPath(max)));
    state.candles = Market.mergeCandles(state.candles, fresh);
    state.updatedAt = new Date().toISOString();
    state.lastError = null;
    saveStore();
    const last = state.candles[state.candles.length - 1];
    log(`Pobrano ${fresh.length} świec; ostatnia ${last ? new Date(last.t).toLocaleTimeString('pl-PL') : '—'}, bid ${last ? last.bid[3] : '—'}.`);
  } catch (e) {
    state.lastError = e.message;
    log('Błąd:', e.message);
  }
}

function schedule() {
  const at = Market.nextFetchAt(Date.now());
  state.nextFetchAt = new Date(at).toISOString();
  setTimeout(async () => { await refresh(); schedule(); }, at - Date.now());
}

// ---------- serwer HTTP (tylko 127.0.0.1) ----------

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.csv': 'text/csv; charset=utf-8' };
const PUBLIC = ['index.html', 'css', 'js']; // tylko pliki aplikacji, nigdy server/.env ani dane

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = path.normalize(urlPath === '/' ? 'index.html' : urlPath.slice(1));
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || !PUBLIC.includes(rel.split(path.sep)[0])) {
    res.writeHead(404).end('Nie znaleziono');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('Nie znaleziono'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(buf);
  });
}

function startServer() {
  http.createServer((req, res) => {
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    if (req.url.startsWith('/api/rynek')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(state));
      return;
    }
    serveStatic(req, res);
  }).listen(CONFIG.port, CONFIG.lan ? '0.0.0.0' : '127.0.0.1', () => {
    log(`Pulpit scalpera: http://127.0.0.1:${CONFIG.port}  (instrument ${CONFIG.epic}, świece 5 min)`);
    if (!CONFIG.lan) return;
    const addrs = Object.values(os.networkInterfaces()).flat()
      .filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
    for (const a of addrs) log(`Z telefonu w tej samej sieci: http://${a}:${CONFIG.port}`);
    if (!addrs.length) log('Nie znaleziono adresu w sieci lokalnej.');
  });
}

// ---------- start ----------

async function main() {
  const missing = ['apiKey', 'identifier', 'password'].filter((k) => !CONFIG[k]);
  if (missing.length) {
    console.error('Brak danych logowania: ustaw CAPITAL_API_KEY, CAPITAL_IDENTIFIER i CAPITAL_PASSWORD');
    console.error('(zmienne środowiskowe lub plik scalping/server/.env — wzór w .env.przyklad).');
    process.exit(1);
  }
  if (typeof fetch !== 'function') {
    console.error('Wymagany Node.js 18 lub nowszy.');
    process.exit(1);
  }

  const i = process.argv.indexOf('--szukaj');
  if (i >= 0) {
    const term = process.argv[i + 1] || 'US100';
    const json = await apiGet(`/markets?searchTerm=${encodeURIComponent(term)}`);
    for (const m of json.markets || []) console.log(`${m.epic}\t${m.instrumentName}\t${m.instrumentType || ''}`);
    if (!(json.markets || []).length) console.log('Brak wyników. Surowa odpowiedź:', JSON.stringify(json).slice(0, 500));
    return;
  }
  if (process.argv.includes('--sprawdz')) {
    const json = await apiGet(pricesPath(2));
    console.log('Surowa odpowiedź (2 ostatnie świece):\n' + JSON.stringify(json, null, 2));
    console.log('\nPo przetworzeniu:', Market.parsePrices(json));
    return;
  }

  loadStore();
  startServer();
  await refresh();
  schedule();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
