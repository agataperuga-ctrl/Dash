# Wskaźniki kwartalne — dashboard z wykrywaniem anomalii

Statyczny dashboard (HTML + JS, bez zależności i bez budowania) prezentujący wyniki kwartalne
wskaźników oraz automatycznie wykryte anomalie.

Repozytorium zawiera też osobną aplikację do scalpingu — zob. [`scalping/README.md`](scalping/README.md).

## Uruchomienie

Otwórz `index.html` w przeglądarce. Domyślnie ładują się syntetyczne dane przykładowe
(6 wskaźników, 2021-Q1 – 2026-Q3) z celowo wstawionymi anomaliami.

## Co pokazuje

- **Kafelki** — wartość wskaźnika w wybranym kwartale, zmiana kw/kw i r/r (dla wskaźników w % w p.p.),
  wartość oczekiwana i odchylenie. Kolor zmiany zależy od kierunku wskaźnika (czy więcej znaczy lepiej).
- **Tabela anomalii** — wszystkie kwartały z anomalią lub do obserwacji; kliknięcie wiersza wybiera kwartał.
- **Wykresy** — przebieg każdego wskaźnika z wartością oczekiwaną, zakresem normy i zaznaczonymi anomaliami;
  podpowiedź po najechaniu (lub klawiszami ←/→), kliknięcie wybiera kwartał.
- **Dane źródłowe** — pełna tabela z oznaczonymi komórkami.
- Filtry: kwartał oraz czułość wykrywania (niska / standardowa / wysoka).

## Własne dane

Przycisk **Wczytaj CSV** (dane przetwarzane wyłącznie w przeglądarce). Format „długi”, jeden wiersz na wskaźnik i kwartał:

```
wskaznik;jednostka;kierunek;kwartal;wartosc
Przychody;mln PLN;wyżej;2024-Q1;120,5
```

- separator `;`, `,` lub tabulator; przecinek dziesiętny jest obsługiwany,
- wymagane kolumny: `wskaznik`, `kwartal`, `wartosc` (polskie znaki w nagłówkach dozwolone),
- `kierunek`: `wyżej` (więcej = lepiej), `niżej` (mniej = lepiej) lub puste,
- kwartał: `2024-Q1`, `2024 Q1`, `Q1 2024`, `I kw. 2024`; brakujące kwartały są dozwolone.

Wzór pliku: `data/wskazniki-przyklad.csv` lub przycisk **Pobierz wzór CSV**.

## Metoda wykrywania anomalii

Dla każdego wskaźnika osobno (`js/anomalies.js`):

1. **Sezonowość** — indeks sezonowy kwartału = mediana stosunku wartości do centrowanej średniej ruchomej 2×4
   (model multiplikatywny; addytywny, gdy szereg ma wartości ≤ 0).
2. **Wartość oczekiwana** — odporny trend Theila–Sena z 6 najbliższych kwartałów (bez badanego) na szeregu
   oczyszczonym z sezonowości. Ostatni kwartał oceniany jest wyłącznie na podstawie historii.
   W drugim przebiegu wykryte anomalie są wyłączane z dopasowania trendu, aby nie zaburzały oceny sąsiadów.
3. **Ocena** — zmodyfikowany z-score (Iglewicz–Hoaglin) reszt: `0,6745 · (r − mediana) / MAD`.
   Anomalia przy |z| ≥ 3,5 (standardowa czułość), „do obserwacji” przy |z| ≥ 2,5.

Wymagane minimum to 8 kwartałów na wskaźnik.

## Testy

```
npm test
```
