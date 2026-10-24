## 1.2.4

- New animated icon and banner in the common Hostwerk style (isometric block). / Neues animiertes Symbol und Banner im gemeinsamen Hostwerk-Stil (isometrischer Block).

## 1.2.3

- Machine tiles use Hostwerk’s own card; “Computers & servers” and “Share this PC” stand side by side, own server in one line; empty machine list as Hostwerk’s empty tile / Rechner-Kacheln nutzen Hostwerks eigene Karte; „Computer & Server“ und „Diesen PC freigeben“ stehen nebeneinander, eigener Server in einer Zeile; leere Rechnerliste als Hostwerks Leer-Kachel

## 1.2.2

- German texts use Hostwerk’s words (“Vorab-Sicherung” instead of “Sicherheits-Backup”). / Deutsche Texte mit Hostwerks Wörtern („Vorab-Sicherung“ statt „Sicherheits-Backup“).

## 1.2.1

- Lives where it belongs: System → Computers – no own sidebar entry any more (Hostwerk 3.0+); the full page stays under Extensions → Open and can be pinned in the sidebar settings. / Steckt jetzt dort, wo sie hingehört: System → Rechner – kein eigener Seitenleisten-Eintrag mehr (Hostwerk 3.0+); die ganze Seite bleibt unter Erweiterungen → Öffnen und lässt sich in den Seitenleisten-Einstellungen anheften.

## 1.2.0

- Every machine tile shows what the other side's `/summary` brings from Hostwerk 3.0 on: an update that is ready, its own last backup (local or external, with a hint if the external one failed) and the health score. Older machines simply show less. / Jede Rechner-Kachel zeigt aus `/summary` der Gegenseite (ab Hostwerk 3.0): bereites Update, eigene letzte Sicherung (lokal/extern, mit Hinweis bei Fehler) und die Gesundheits-Punktzahl.
- Fix: the copy of a server on this PC (`pulledBackup`) no longer gets overwritten by the other side's own backup field. / Korrektur: die Kopie eines Servers auf diesem PC wird nicht mehr vom Sicherungsfeld der Gegenseite überschrieben.

## 1.1.0

- Streaming for moves: `rawFile()` sends files/streams, `download()` writes straight to disk (via `.part`) – Hostwerk's move uses them instead of buffers. / Streaming beim Umzug: `rawFile()` sendet Dateien/Streams, `download()` schreibt direkt auf die Platte (über `.part`) – Hostwerks Umzug nutzt sie statt Puffern.
- Outage alerts (interface and push) after two failed checks, and when the machine is back. / Ausfall-Meldung (Oberfläche und Push) nach zwei Fehlversuchen und wenn der Rechner zurück ist.
- Version differences marked; update Hostwerk on the other machine with one click. / Versionsunterschiede markiert; Hostwerk auf dem anderen Rechner per Klick aktualisieren.
- “Move from this machine …” in the right-click menu. / „Von diesem Rechner umziehen …“ im Rechtsklick-Menü.
- Machine symbol in the accent colour instead of a fixed gradient; design scale instead of fixed pixels; dates in Hostwerk's language. / Rechner-Symbol in der Akzentfarbe statt festem Verlauf; Design-Skala statt fester Pixel; Datum in Hostwerks Sprache.
- Error states with “Try again”; the overview no longer polls while hidden. / Fehlerzustände mit „Erneut versuchen“; die Übersicht fragt bei verstecktem Reiter nicht mehr.
- Sidebar group “System” (`page.nav`), other extensions may add tabs (`allowExtensions`). Release package contains everything except the repository tooling. / Seitenleisten-Gruppe „System“ (`page.nav`), andere Erweiterungen dürfen Reiter ergänzen (`allowExtensions`). Release-Paket enthält alles außer dem Repo-Werkzeug.

## 1.0.0

- First release as its own extension (before: built into Hostwerk). Data stays where it was. / Erste Fassung als eigene Erweiterung (vorher fest in Hostwerk). Daten bleiben, wo sie waren.
