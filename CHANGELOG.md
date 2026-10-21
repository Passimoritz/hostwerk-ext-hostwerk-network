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
