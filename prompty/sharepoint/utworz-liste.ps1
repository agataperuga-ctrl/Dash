<#
.SYNOPSIS
  Tworzy w SharePoint / Microsoft Lists listę „Biblioteka promptów” z kolumnami, widokami
  i formatowaniem (kolorowe znaczniki kategorii, statusu i narzędzi).

.DESCRIPTION
  Wymaga modułu PnP.PowerShell (PowerShell 7+):  Install-Module PnP.PowerShell -Scope CurrentUser
  oraz własnej rejestracji aplikacji w Entra ID (jednorazowo, administrator lub osoba z uprawnieniami):
      Register-PnPEntraIDAppForInteractiveLogin -ApplicationName "PnP Prompty" -Tenant firma.onmicrosoft.com
  Polecenie zwraca ClientId, który podajesz w parametrze -ClientId.

  Skrypt można uruchamiać ponownie: istniejące kolumny zostają (dostają tylko formatowanie),
  widoki są tworzone od nowa.

.EXAMPLE
  ./utworz-liste.ps1 -SiteUrl https://firma.sharepoint.com/sites/Zespol -ClientId 00000000-0000-0000-0000-000000000000

.EXAMPLE
  # Utworzenie listy i wczytanie promptów wyeksportowanych z aplikacji (prompty/index.html → Eksportuj CSV)
  ./utworz-liste.ps1 -SiteUrl https://firma.sharepoint.com/sites/Zespol -ClientId ... -ImportCsv ./prompty-2026-11-07.csv
#>
param(
  [Parameter(Mandatory)] [string] $SiteUrl,
  [Parameter(Mandatory)] [string] $ClientId,
  [string] $ListTitle = 'Biblioteka promptów',
  [string] $ListUrl = 'Lists/BibliotekaPromptow',
  [string] $ImportCsv
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# Te same wartości co w prompty/js/prompts.js — zmieniaj w obu miejscach.
$Kategorie = @('pisanie', 'analiza', 'Excel', 'spotkania', 'inne')
$Narzedzia = @('Microsoft 365 Copilot', 'Copilot w Word', 'Copilot w Excel', 'Copilot w Outlook',
               'Copilot w Teams', 'ChatGPT', 'Claude', 'Gemini')
$Statusy   = @('Szkic', 'Sprawdzony')

function Choices([string[]] $values) {
  ($values | ForEach-Object { "<CHOICE>$([System.Security.SecurityElement]::Escape($_))</CHOICE>" }) -join ''
}

Connect-PnPOnline -Url $SiteUrl -Interactive -ClientId $ClientId

$list = Get-PnPList -Identity $ListTitle -ErrorAction SilentlyContinue
if (-not $list) {
  Write-Host "Tworzę listę „$ListTitle”…"
  $list = New-PnPList -Title $ListTitle -Url $ListUrl -Template GenericList -OnQuickLaunch
}
Set-PnPList -Identity $list -EnableVersioning $true -MajorVersions 50 `
  -Description 'Wspólna biblioteka sprawdzonych promptów zespołu.' | Out-Null

# Kolumna systemowa Title → „Tytuł”
Set-PnPField -List $list -Identity 'Title' -Values @{ Title = 'Tytuł' } | Out-Null

$fields = [ordered]@{
  'Prompt'       = "<Field Type='Note' Name='Prompt' StaticName='Prompt' DisplayName='Prompt' Required='TRUE' NumLines='12' RichText='FALSE' AppendOnly='FALSE' Description='Pełna treść promptu. Miejsca do uzupełnienia oznacz np. [NAWIASAMI].' />"
  'DoCzegoSluzy' = "<Field Type='Note' Name='DoCzegoSluzy' StaticName='DoCzegoSluzy' DisplayName='Do czego służy' NumLines='3' RichText='FALSE' AppendOnly='FALSE' />"
  'Kategoria'    = "<Field Type='Choice' Name='Kategoria' StaticName='Kategoria' DisplayName='Kategoria' Required='TRUE' Format='Dropdown' FillInChoice='FALSE'><Default>inne</Default><CHOICES>$(Choices $Kategorie)</CHOICES></Field>"
  'GdzieDziala'  = "<Field Type='MultiChoice' Name='GdzieDziala' StaticName='GdzieDziala' DisplayName='Gdzie działa' FillInChoice='FALSE'><CHOICES>$(Choices $Narzedzia)</CHOICES></Field>"
  'Uwagi'        = "<Field Type='Note' Name='Uwagi' StaticName='Uwagi' DisplayName='Uwagi' NumLines='3' RichText='FALSE' AppendOnly='FALSE' />"
  'Status'       = "<Field Type='Choice' Name='Status' StaticName='Status' DisplayName='Status' Required='TRUE' Format='RadioButtons' FillInChoice='FALSE'><Default>Szkic</Default><CHOICES>$(Choices $Statusy)</CHOICES></Field>"
}

foreach ($name in $fields.Keys) {
  if (Get-PnPField -List $list -Identity $name -ErrorAction SilentlyContinue) {
    Write-Host "Kolumna $name już istnieje — pomijam."
  } else {
    Write-Host "Dodaję kolumnę $name…"
    Add-PnPFieldFromXml -List $list -FieldXml $fields[$name] | Out-Null
  }
}

# Formatowanie kolumn (warstwa wizualna w SharePoint)
foreach ($pair in @(
    @('Kategoria', 'kolumna-kategoria.json'),
    @('Status', 'kolumna-status.json'),
    @('GdzieDziala', 'kolumna-gdzie-dziala.json'),
    @('Prompt', 'kolumna-prompt.json'))) {
  $json = Get-Content -Raw -Encoding UTF8 (Join-Path $here $pair[1])
  Set-PnPField -List $list -Identity $pair[0] -Values @{ CustomFormatter = $json } | Out-Null
}

# Widoki
$viewFields = @('LinkTitle', 'Kategoria', 'Status', 'DoCzegoSluzy', 'Prompt', 'GdzieDziala', 'Uwagi', 'Modified')
$rowFormat = Get-Content -Raw -Encoding UTF8 (Join-Path $here 'widok-wiersze.json')

$default = Get-PnPView -List $list | Where-Object { $_.DefaultView }
Set-PnPView -List $list -Identity $default.Id -Fields $viewFields `
  -Values @{ ViewQuery = "<OrderBy><FieldRef Name='Modified' Ascending='FALSE' /></OrderBy>"; CustomFormatter = $rowFormat } | Out-Null

$views = @(
  @{ Title = 'Do sprawdzenia'
     Query = "<Where><Eq><FieldRef Name='Status' /><Value Type='Choice'>Szkic</Value></Eq></Where><OrderBy><FieldRef Name='Modified' Ascending='FALSE' /></OrderBy>"
     Fields = @('LinkTitle', 'Kategoria', 'DoCzegoSluzy', 'Prompt', 'GdzieDziala', 'Uwagi', 'Editor', 'Modified') },
  @{ Title = 'Pogrupowane wg kategorii'
     Query = "<GroupBy Collapse='FALSE' GroupLimit='100'><FieldRef Name='Kategoria' /></GroupBy><OrderBy><FieldRef Name='Title' /></OrderBy>"
     Fields = @('LinkTitle', 'Status', 'DoCzegoSluzy', 'Prompt', 'GdzieDziala', 'Modified') }
)
foreach ($v in $views) {
  $old = Get-PnPView -List $list -Identity $v.Title -ErrorAction SilentlyContinue
  if ($old) { Remove-PnPView -List $list -Identity $old.Id -Force }
  Write-Host "Tworzę widok „$($v.Title)”…"
  Add-PnPView -List $list -Title $v.Title -Fields $v.Fields -Query $v.Query -RowLimit 100 | Out-Null
}

# Opcjonalny import z CSV wyeksportowanego z aplikacji (separator „;”, UTF-8 z BOM)
if ($ImportCsv) {
  $rows = Import-Csv -Path $ImportCsv -Delimiter ';' -Encoding UTF8
  $n = 0
  foreach ($r in $rows) {
    if (-not $r.'Tytuł' -or -not $r.Prompt) { continue }
    $gdzie = @($r.'Gdzie działa' -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ -in $Narzedzia })
    $values = @{
      Title        = $r.'Tytuł'
      Prompt       = $r.Prompt
      DoCzegoSluzy = $r.'Do czego służy'
      Kategoria    = $(if ($r.Kategoria -in $Kategorie) { $r.Kategoria } else { 'inne' })
      Uwagi        = $r.Uwagi
      Status       = $(if ($r.Status -in $Statusy) { $r.Status } else { 'Szkic' })
    }
    if ($gdzie.Count) { $values.GdzieDziala = $gdzie }
    Add-PnPListItem -List $list -Values $values | Out-Null
    $n++
  }
  Write-Host "Zaimportowano $n promptów."
}

Write-Host "Gotowe: $SiteUrl/$ListUrl"
