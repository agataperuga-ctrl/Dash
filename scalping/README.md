# Scalping — kalkulator pozycji i dziennik

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

## Instrumenty

Presety (Akcje, Kontrakt FW20, Kryptowaluty, Forex, Własny) mają **przykładowe** stawki — wpisz stawki swojego brokera
w „Parametry instrumentu”. Prowizja za stronę = `max(% · wartość + stała · ilość, minimum)`.
Wyniki są w walucie kwotowania instrumentu (bez przeliczania kursu, np. dla par forex z inną walutą kwotowania).

## Skróty

Poza polami tekstowymi: `L` / `S` — kierunek, `T` / `X` / `B` — wyjście po TP / SL / BE. `Enter` w formularzu zapisuje transakcję.

## Testy

Obliczenia są w `js/scalp.js` (bez zależności od DOM), testy w `tests/scalp.test.js`: `npm test` w katalogu głównym.
