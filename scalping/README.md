# Pulpit scalpera — kalkulator pozycji i dziennik

Statyczna aplikacja (HTML + JS, bez zależności i bez budowania). Otwórz `scalping/index.html` w przeglądarce.
Nie łączy się z brokerem i nie składa zleceń — liczy, pilnuje limitów i zapisuje wyniki.

## Co robi

- **Kalkulator pozycji** — z kapitału, ryzyka na transakcję (%), wejścia i stop lossa liczy wielkość pozycji tak,
  aby strata na stopie **łącznie z prowizjami za wejście i wyjście** nie przekroczyła budżetu ryzyka.
  Uwzględnia krok wielkości, mnożnik (wartość punktu) i maks. dźwignię. Pokazuje:
  stratę na SL i zysk na TP netto, R:R netto i brutto, próg rentowności (cena i liczba ticków), wartość pozycji, depozyt.
  Ostrzega, gdy TP nie pokrywa prowizji, R:R po kosztach < 1 lub prowizje to ≥ 25% straty na stopie.
- **Take profit** jako wielokrotność ryzyka (× R) albo cena.
- **Zapis transakcji** — cena wyjścia z przycisków TP / SL / BE lub ręcznie; wynik netto i R liczone automatycznie.
- **Strażnik ryzyka dnia** — maks. dzienna strata (% kapitału), maks. liczba transakcji, maks. strat z rzędu.
  Status: można handlować / uwaga / STOP. Pozostały dzienny limit straty **obcina wielkość pozycji** w kalkulatorze.
- **Dziennik** — dziś / wszystkie: wynik netto, skuteczność, profit factor, średni R, średni zysk/strata,
  prowizje, maks. obsunięcie. Eksport i import CSV (`;`, przecinek dziesiętny).

Dane zapisywane są w `localStorage` tej przeglądarki — rób eksport CSV jako kopię zapasową.

## Notowania USTECH100 z Capital.com (zakładka „USTECH100”)

Druga zakładka pokazuje świece 5-minutowe pobierane z API Capital.com: bid / ask / spread, zmianę do poprzedniej
świecy i od początku dnia, zakres dnia, średni zakres świecy z ostatniej godziny, wykres świecowy (3–24 h)
i tabelę ostatnich świec. Przyciski „Wejście long po ask” / „Wejście short po bid” przenoszą cenę do kalkulatora
(z presetem USTECH100).

Przeglądarka nie może bezpiecznie łączyć się z brokerem (klucz API byłby widoczny w stronie), dlatego dane pobiera
mały lokalny serwer pośredniczący `server/capital-proxy.js` (Node.js 18+, bez zależności):

1. W Capital.com włącz 2FA i wygeneruj klucz API (Ustawienia → API integrations). Przy tworzeniu klucza ustawiasz jego hasło.
2. Skopiuj `server/.env.przyklad` jako `server/.env` i uzupełnij: `CAPITAL_API_KEY`, `CAPITAL_IDENTIFIER` (login),
   `CAPITAL_PASSWORD` (hasło klucza), `CAPITAL_DEMO` (1 = demo). Plik `.env` jest w `.gitignore`.
3. Sprawdź kod instrumentu: `node scalping/server/capital-proxy.js --szukaj "US Tech"` i w razie potrzeby ustaw `CAPITAL_EPIC`
   (domyślnie `US100`). `--sprawdz` wypisuje surową odpowiedź z dwiema ostatnimi świecami.
4. Uruchom `node scalping/server/capital-proxy.js` i otwórz **http://127.0.0.1:8787**.

Serwer pobiera dane 10 s po zamknięciu każdej świecy 5-minutowej (na starcie ~1000 świec historii), odnawia sesję
po wygaśnięciu, zapisuje świece w `scalping/dane/` (poza repozytorium, ostatnie 3000) i nasłuchuje tylko na 127.0.0.1.
Strona odpytuje go co 30 s i pokazuje status: na żywo / dane nieaktualne / brak notowań (rynek zamknięty) / błąd.

**Na telefonie:** ustaw `DOSTEP_Z_SIECI=1` w `.env` i uruchom serwer — po starcie wypisze adresy typu `http://192.168.1.23:8787`
do otwarcia w telefonie podłączonym do tego samego Wi-Fi. Poza domem: zainstaluj Tailscale na komputerze i telefonie
(to samo konto) i otwórz `http://<adres-Tailscale-komputera>:8787`. Udostępniane są tylko pliki aplikacji i notowania —
nigdy `.env`. Dziennik na telefonie jest osobny (zapisuje się w przeglądarce telefonu).

Otwarta jako plik (`file://`) aplikacja działa normalnie, a zakładka notowań pokazuje instrukcję uruchomienia serwera.

## Instrumenty

Presety (Akcje, Kontrakt FW20, Kryptowaluty, USTECH100 (CFD), Forex, Własny) mają **przykładowe** stawki — wpisz stawki swojego brokera
w „Parametry instrumentu”. Prowizja za stronę = `max(% · wartość + stała · ilość, minimum)`.
Wyniki są w walucie kwotowania instrumentu (bez przeliczania kursu, np. dla par forex z inną walutą kwotowania).

## Skróty

Poza polami tekstowymi: `L` / `S` — kierunek, `T` / `X` / `B` — wyjście po TP / SL / BE. `Enter` w formularzu zapisuje transakcję.

## Testy

Obliczenia są w `js/scalp.js` i `js/market.js` (bez zależności od DOM), testy w `tests/scalp.test.js` i `tests/market.test.js`: `npm test` w katalogu głównym.
