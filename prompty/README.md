# Biblioteka promptów zespołu

Lista do zbierania promptów w dwóch wariantach o **tym samym schemacie**:

1. **Microsoft Lists / SharePoint** — wspólna lista dla zespołu (`sharepoint/utworz-liste.ps1`).
2. **Aplikacja w przeglądarce** — przyjazny widok kart / tabeli z wyszukiwaniem, filtrami i sortowaniem
   (`index.html`, bez zależności i bez budowania). Między wariantami przenosi się dane przez CSV.

## Kolumny

| Kolumna | Typ | Nazwa wewnętrzna | Uwagi |
|---|---|---|---|
| Tytuł | jeden wiersz tekstu, wymagane | `Title` | |
| Prompt | wiele wierszy, zwykły tekst, wymagane | `Prompt` | zachowuje podział na linie |
| Do czego służy | wiele wierszy | `DoCzegoSluzy` | |
| Kategoria | wybór, wymagane | `Kategoria` | pisanie, analiza, Excel, spotkania, inne (domyślnie: inne) |
| Gdzie działa | wybór wielokrotny | `GdzieDziala` | Microsoft 365 Copilot, Copilot w Word / Excel / Outlook / Teams, ChatGPT, Claude, Gemini |
| Uwagi | wiele wierszy | `Uwagi` | |
| Status | wybór, wymagane | `Status` | Szkic (domyślnie), Sprawdzony |

Listę narzędzi w „Gdzie działa” zmieniasz w dwóch miejscach: `js/prompts.js` (`PLACES`) i `sharepoint/utworz-liste.ps1` (`$Narzedzia`).

## Widoki

- **Wszystkie** — od ostatnio zmienionych; szkice podświetlone.
- **Do sprawdzenia** — tylko `Status = Szkic`, od ostatnio zmienionych. Nowy prompt domyślnie trafia tutaj.
- **Pogrupowane wg kategorii** — grupy według kategorii, w grupie alfabetycznie po tytule.

## Aplikacja (`prompty/index.html`)

Otwórz plik w przeglądarce. Na start zawiera 5 przykładowych promptów (można je edytować lub usunąć).

- **Karty** (domyślnie) lub **tabela** — w tabeli klik w nagłówek sortuje, drugi klik odwraca kierunek.
- **Wyszukiwanie** w tytule, treści, celu i uwagach; bez rozróżniania wielkości liter i polskich znaków
  („formula” znajdzie „Formuła”); wiele słów = wszystkie muszą wystąpić; trafienia są podświetlone.
- **Filtry**: kategorie (kilka naraz), „Gdzie działa”, status; **sortowanie**: ostatnio zmienione, tytuł
  (polska kolejność alfabetyczna), kategoria, status, data dodania, „do czego służy”, liczba narzędzi.
- **Kopiuj** — kopiuje pełny prompt do schowka; **Pokaż całość** rozwija długi prompt.
- **Dodawanie i edycja** w oknie z walidacją (tytuł i prompt wymagane); ostrzeżenie przed porzuceniem zmian.
- Skróty: `/` — szukaj, `N` — nowy prompt, `Esc` — wyczyść wyszukiwanie.
- Jasny i ciemny motyw (wg ustawień systemu), układ działa na telefonie.

Dane zapisują się w `localStorage` **tej przeglądarki** — inne osoby ich nie widzą. Do pracy zespołowej używaj
listy SharePoint albo wymieniajcie się plikami CSV:

- **Eksportuj CSV** — wszystkie prompty, separator `;`, UTF-8 z BOM (Excel otwiera poprawnie polskie znaki).
- **Importuj CSV** — przyjmuje plik z eksportu aplikacji oraz eksport z Microsoft Lists (nagłówki po polsku
  lub nazwy wewnętrzne, separator `;`, `,` lub tabulator). Duplikaty (ten sam tytuł i treść) nie są dublowane —
  nowsza wersja zastępuje starszą. Nieznane kategorie trafiają do „inne”, nieznane narzędzia są pomijane (z ostrzeżeniem).

## Lista w SharePoint (`prompty/sharepoint/`)

Wymagania: PowerShell 7+, moduł `PnP.PowerShell` i rejestracja aplikacji w Entra ID (jednorazowo):

```powershell
Install-Module PnP.PowerShell -Scope CurrentUser
Register-PnPEntraIDAppForInteractiveLogin -ApplicationName "PnP Prompty" -Tenant firma.onmicrosoft.com   # zwraca ClientId
./prompty/sharepoint/utworz-liste.ps1 -SiteUrl https://firma.sharepoint.com/sites/Zespol -ClientId <ClientId>
# opcjonalnie od razu z promptami z aplikacji:
./prompty/sharepoint/utworz-liste.ps1 -SiteUrl ... -ClientId ... -ImportCsv ./prompty-2026-11-07.csv
```

Skrypt tworzy listę z kolumnami i trzema widokami, włącza historię wersji i nakłada formatowanie:

| Plik | Co robi |
|---|---|
| `kolumna-kategoria.json` | kolorowy znacznik kategorii (te same kolory co w aplikacji) |
| `kolumna-status.json` | ✎ Szkic (żółty) / ✓ Sprawdzony (zielony) |
| `kolumna-gdzie-dziala.json` | każde narzędzie jako osobny znacznik |
| `kolumna-prompt.json` | treść czcionką o stałej szerokości z zachowaniem linii, skrócona do ~5 wierszy (pełna w podpowiedzi) |
| `widok-wiersze.json` | podświetla wiersze ze statusem Szkic w widoku „Wszystkie” |

Formatowanie można też wkleić ręcznie: kolumna → *Ustawienia kolumny → Formatuj tę kolumnę → Tryb zaawansowany*.
Sortowanie i filtrowanie w SharePoint daje sama lista (nagłówki kolumn i panel filtrów).

Bez skryptu listę można założyć ręcznie w Microsoft Lists według tabeli kolumn powyżej
(widok „Do sprawdzenia”: filtr Status = Szkic; „Pogrupowane wg kategorii”: Grupuj według → Kategoria).
