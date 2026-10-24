# Lernkasten

Lernkarten-App (PWA) mit eigenen Stapeln, Wiederholung in Abständen wie bei Anki und Statistik.
Alles wird lokal im Browser gespeichert (localStorage), ohne Login und ohne Server.

## Funktionen
- Stapel und Karten anlegen, ändern, löschen; Massenimport `Frage ; Antwort` pro Zeile (auch Tab aus Excel)
- Lernen: Falsch = Karte kommt in derselben Runde nach 3 Karten wieder, Abstand startet neu bei 1 Tag
- Richtig = Abstand wächst (1 Tag → 3 Tage → Abstand × Leichtigkeitsfaktor)
- „Schwachstellen üben“: die 20 Karten mit der höchsten Fehlerquote
- Statistik: Trefferquote, Lernserie, 14-Tage-Diagramm, Lernstand, Fälligkeiten 7 Tage, schwierigste Karten
- Sicherung als Text kopieren und auf anderem Gerät einspielen
- Installierbar und offline nutzbar (Manifest + Service Worker)

## Dateien
| Datei | Zweck |
|---|---|
| `index.html` | die komplette App (HTML, CSS, JS) |
| `manifest.webmanifest` | Name, Farben, Icons für „Zum Startbildschirm hinzufügen“ |
| `sw.js` | Service Worker für Offline-Betrieb |
| `icons/` | App-Icons |
| `.nojekyll` | GitHub Pages liefert Dateien unverändert aus |

## Auf GitHub Pages veröffentlichen
```bash
git init
git add .
git commit -m "Lernkasten PWA"
git branch -M main
git remote add origin https://github.com/<ORGANISATION>/<REPO>.git
git push -u origin main
```
Dann im Repo: **Settings → Pages → Build and deployment → Source: „Deploy from a branch“ → Branch `main`, Ordner `/ (root)` → Save.**
Nach 1–2 Minuten läuft die App unter `https://<organisation>.github.io/<repo>/`.

Alle Pfade sind relativ, die App funktioniert also auch in einem Unterordner.

## Updates ausrollen
Nach Änderungen in `sw.js` die Zeile `const VERSION = 'v1';` hochzählen (`v2`, `v3` …), sonst sehen installierte Apps die alte Version aus dem Cache.

## Hinweis zu den Daten
Die Lerndaten liegen nur im Browser des jeweiligen Geräts. Browserdaten löschen = Karten weg. Deshalb unter „Daten“ regelmäßig eine Sicherung kopieren.
