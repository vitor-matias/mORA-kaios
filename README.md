# mORA for KaiOS 2.5 — proof of concept

A feature-phone companion to [mORA](https://github.com/vitor-matias/mORA):
the **Liturgia das Horas** and the day's **Missa** readings (European
Portuguese, Portuguese rite), built for KaiOS 2.5 devices (Nokia 6300 4G,
8110 4G class) — 240×320 screen, D-pad + softkeys, no touch.

This is the "Option C" lightweight shell from the port-requirements
analysis (see `docs/requirements.md`): **no framework, no build step, no
service worker** — plain HTML/CSS/JS written within Gecko 48's syntax and
CSS budget (no `async/await`, no optional chaining, no flexbox `gap`, no
grid), shipped as a privileged packaged app (`manifest.webapp`).

## Features

- **Liturgia das Horas** — the five canonical hours (Ofício de Leitura,
  Laudes, Hora Intermédia, Vésperas, Completas) assembled from the API
  parts exactly as the mORA web app does, defaulting to the hour that fits
  the current time of day. Choosing Hora Intermédia opens a second
  chooser for Tércia/Sexta/Noa, pre-selected by time of day.
- **Missa do dia** — the day's Mass, defaulting to the readings only
  (same extraction as the mORA web app); the full missal is a toggle in
  the options menu.
- Day navigation (previous/next/today), per-day `localStorage` cache with
  automatic pruning of past days, stale-cache fallback when offline, and a
  bundled sample day so the app always renders something. After a
  successful load the next 5 days are quietly prefetched, and network
  requests time out after 15 s instead of hanging (Gecko 48 has no
  AbortController).
- An un-navigated app follows the calendar: it re-anchors to the new day
  after midnight or when resumed from the background, and the Missa view
  defaults to Sunday's Mass from Saturday 16:00 (vigil). Manual day
  navigation pins the chosen date until "Hoje".
- Hands-free **autoscroll** for praying without touching the keypad.
- Serif reading face by default (sans as a menu option), seven text
  sizes from 13px up to 32px — the upper steps sized for big screens
  like a Kindle's browser — and a light/dark theme, all persisted. A fullscreen toggle
  hides the browser/system chrome. Section headers in the liturgy text
  (LEITURA I, Antífona…) are typeset as labelled separators.

## Controls

| Key | Action |
|---|---|
| ↑ / ↓ | Scroll the reading / move the selection in menus |
| ← / → | Previous / next day |
| Enter (D-pad centre) | Open the hour chooser (in Horas) / select |
| SoftLeft | Options menu |
| SoftRight / Back | Back / exit (with confirmation) |
| 1–5 | Jump straight to a canonical hour |
| 7 | Options menu (alias for SoftLeft) |
| 9 | Switch Horas ⇄ Missa |
| 0 | Toggle autoscroll |
| * / # | Smaller / larger text |

Desktop testing: `q` = SoftLeft, `e` = SoftRight; Escape closes menus.

Key ownership is split: **the action keys (SoftLeft/SoftRight/Back) keep
their browser meaning in a browser tab** — so the browser's softkey menu
with "Add to Home Screen" works — and only the packaged/installed app
claims them. **The number pad (digits, `*`, `#`) is claimed everywhere**,
suppressing the browser's conflicting digit shortcuts. There is no
on-screen softkey bar: in a browser, drive the app with the clickable
controls (‹ › day arrows; **clicking the date opens the options menu**;
menu entries select on click), the digit shortcuts, and `7` for the
options menu. Appending `?browser=1` hands every key back to the browser.

## Running it

**Hosted (GitHub Pages):** <https://vitor-matias.github.io/mORA-kaios/> —
deployed automatically from `main` by `.github/workflows/pages.yml`.
KaiOS 2.5's browser can also open this URL directly, which is a quick way
to try the app on a device before sideloading the packaged version.

**In a desktop browser** (for development):

```bash
cd mora-kaios
python3 -m http.server 8000     # or: npx http-server
# open http://localhost:8000 and resize to ~240×320
```

The liturgy API (`apiapp.glauco.it`) serves CORS headers, so live data
works from a plain browser too. With no network, the app falls back to the
day's cache and then to the bundled sample content (clearly bannered).

**On a KaiOS 2.5 device** (sideload):

1. Enable debugging on the phone (varies by device; on Nokia devices dial
   `*#*#33284#*#*` — a bug icon appears in the status bar).
2. Connect over USB and use the old Firefox WebIDE (Firefox 59 or the
   community *KaiOS RunTime* tooling / `gdeploy`) to "Open Packaged App"
   pointing at this folder, then install & run.
3. Alternatively, zip the folder contents (`manifest.webapp` at the zip
   root) and install with an OmniSD-compatible sideloader.

## Architecture

```
manifest.webapp   privileged packaged-app manifest (systemXHR, pt locale)
index.html        static shell; three plain <script> tags, no inline JS
css/app.css       QVGA layout; margins-only spacing (no gap/grid on Gecko 48)
js/liturgy.js     data layer — port of mORA's src/lib/liturgy.ts + hours.ts:
                  same GraphQL query, same cache keys and pruning, same
                  wrong-day-response guard, same canonical-hour assembly
js/sample.js      bundled offline/demo day (flagged in the UI)
js/app.js         shell: state, rendering, D-pad/softkey input, overlays,
                  autoscroll, font sizes, HTML sanitisation
icons/            56/112 px launcher icons
```

Everything network-y goes through `fetch` — the liturgy API supports CORS,
so `systemXHR` is not strictly needed for it (it's declared for headroom;
note that on Gecko 48 `systemXHR` only applies to `XMLHttpRequest` with
`mozSystem: true`, not to `fetch`).

## PoC limitations / next steps

- Not yet tested on real KaiOS hardware — that is the point of the PoC.
  Chromium-at-240×320 smoke tests pass; Gecko 48 verification (WebIDE)
  is the next step.
- The saints' offices and Ofício de Defuntos (mORA's `public/lh` breviary
  data) are not included.
- No reminders (`mozAlarms`) yet — see the requirements doc, §3.5.
