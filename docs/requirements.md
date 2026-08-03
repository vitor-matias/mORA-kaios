# Porting mORA to KaiOS 2.5 — Requirements & Feasibility

Target platform: **KaiOS 2.5.x** (Nokia 6300 4G, 8110 4G, JioPhone class —
the large majority of KaiOS devices in the wild). KaiOS 2.5 runs **Gecko 48**
(Firefox, mid-2016), ships apps as Firefox-OS-style *packaged apps*
(`manifest.webapp`), and has **no service workers, no Web Push, no
WebAssembly, and no BigInt**.

**Scope: the KaiOS port carries only the reading features — Liturgia das
Horas and the Missa Diária readings.** Nostr sync, streaks, profile/identity
management, and the Rosary are explicitly out of scope. This is a deliberate
fit: what remains is a fetch-cache-render app of long liturgical documents,
which is exactly the kind of app a feature phone does well — and it removes
the one hard blocker a full port would have had (Nostr's secp256k1 stack is
built on `BigInt`, which Gecko 48 lacks and nothing can transpile away).

## TL;DR

- With the reduced scope there is **no blocker** — every remaining
  dependency (fetch, WebSocket-free, `localStorage`, the breviary assembly
  code) works on Gecko 48 after transpilation.
- The port still cannot ship as-built. Three structural work items:
  1. **The service-worker PWA model doesn't exist** — offline comes from
     being a packaged app; the `vite-plugin-pwa`/`src/sw.ts` layer is
     web-only.
  2. **The styling relies on CSS Gecko 48 doesn't have** — flexbox `gap`
     (~90 usages, silently collapses to zero spacing) and CSS grid.
  3. **All JS must be transpiled to pre-2017 syntax** — no ES modules,
     `async/await`, optional chaining, or nullish coalescing. Mechanical
     via `@vitejs/plugin-legacy`, but React 19 at ES5 on a 256 MB phone
     needs an on-device performance check before committing to it.
- The **data layer ports cleanly**: `src/lib/liturgy.ts` (fetch + per-day
  `localStorage` cache), `src/lib/breviary/` (office assembly),
  `src/lib/hours.ts`, and `dayInfo.ts` are UI-free and BigInt-free.
- Because the KaiOS app is now just two reading surfaces plus date/office
  pickers, a **purpose-built lightweight shell over that data layer
  (Option C)** is the recommended plan of record; a transpiled-React spike
  (Option A) is still worth a few days first, since it would keep one UI
  codebase if it happens to perform.

## 1. Platform constraints (KaiOS 2.5 / Gecko 48)

Hardware: 240×320 (QVGA) portrait screen, **D-pad + two softkeys + number
pad, no touch**, 256–512 MB RAM, slow single/dual-core CPUs, small storage
quotas (localStorage ~5 MB, IndexedDB available).

What Gecko 48 **has** that the reduced app relies on: ES6 core (classes,
arrows, `let`/`const`, template literals, `Promise`, `Map`/`Set`),
`fetch`, `localStorage`, CSS custom properties, flexbox,
`position: sticky`, `matchMedia`.

What it **lacks**, mapped to the in-scope code:

| Missing (landed in FF) | Where it bites us | Fix |
|---|---|---|
| Service workers / Push | `vite-plugin-pwa`, `src/sw.ts` | Packaged-app offline (§3.1); reminders, if kept, via `mozAlarms` (§3.5) |
| ES modules (60), `async/await` (52), object spread (55), `?.` (74), `??` (72) | Everywhere in `src/` and dependencies | Transpile (`@vitejs/plugin-legacy`) |
| Flexbox `gap` (63) | ~90 `gap-*` Tailwind usages | Replace with `space-x/y-*` or margins (§3.3) |
| CSS grid (52) | `grid-cols-7` calendar, `grid-cols-2/3/5` pickers | Rebuild those few layouts on flexbox |
| Pointer Events (59) | `pointerdown` outside-click handler, `src/pages/LiturgiaHoras.tsx:442` | `mousedown` fallback |
| `IntersectionObserver` (55) | `src/pages/Liturgy.tsx:537` | Polyfill (small, standard) |
| `AbortController` (57) | 2 direct uses + react-router internals | Polyfill via core-js/plugin-legacy |
| `backdrop-filter` (103) | 2 usages in `src/index.css` | Opaque surfaces (also a perf win) |
| Wake Lock API (never in Gecko) | Autoscroll screen-awake, `src/lib/useAutoScroll.ts:112` (already feature-detected) | Packaged-app `requestWakeLock('screen')` system API |
| `queueMicrotask` (69) | React internals (Option A only) | Polyfill (trivial) |

Dropped features take their compatibility problems with them: no `BigInt`
issue (Nostr crypto), no `crypto.subtle` key vault, no WebSocket relays, no
`navigator.clipboard`, no Web Push subscription flow.

## 2. Shell strategy — two live options

**Option A — transpiled React build (spike first).** A KaiOS build mode with
`@vitejs/plugin-legacy` (SystemJS + core-js; Gecko 48 has no ES modules so
it always takes the legacy path), with the out-of-scope routes and their
imports (`nostr-tools`, signer, Rosary, Profile) excluded so they never
enter the bundle. React's published packages are old-syntax-safe, so this
should parse and boot; the open question is purely performance — ES5
React 19 + polyfills on a 256 MB, ~1.1 GHz device. **Requirement: a
go/no-go spike on real hardware (6300 4G) measuring cold start (< 5 s) and
reading-view scroll.** The payoff if it passes: one UI codebase.

**Option C — lightweight KaiOS shell over the shared core (plan of
record).** Keep the UI-free data layer and build a small vanilla D-pad UI.
With the reduced scope this is genuinely small: two reading views (Horas,
Missa), a date navigator, an hour/office chooser, and a settings screen
(text size, theme). This is the classic KaiOS approach and guarantees the
performance budget, at the cost of a second thin UI to maintain.

(A Preact `compat` middle ground exists but is only worth reaching for if
the Option A spike fails narrowly on memory rather than broadly on speed.)

## 3. Requirements by area

### 3.1 Build & packaging

1. A separate KaiOS build (`vite build --mode kaios` or a dedicated entry):
   plugin-legacy (Option A) or a plain transpiled bundle (Option C), no
   `vite-plugin-pwa`, no `src/sw.ts`, output as a **packaged app** — every
   asset in the zip, nothing loaded from the network at boot.
2. **Self-host the fonts or drop them.** `index.html` loads Inter and Lora
   from Google Fonts at runtime — not allowed in a packaged app and
   wasteful at QVGA. Recommendation: system fonts on KaiOS.
3. **No inline scripts.** Privileged packaged apps enforce a CSP
   (`script-src 'self'`) that forbids the inline theme-bootstrap script in
   `index.html:11` — move it to a bundled external file for the KaiOS build.
4. Icons: KaiOS wants 56×56 and 112×112 (we ship 192/512 today).

### 3.2 Input model — the biggest UX work item

The app is touch-first; KaiOS 2.5 has no touchscreen. Everything must work
with ↑↓←→, Enter (D-pad centre), the two softkeys, and the back key.

1. **Long-document reading is the primary interaction**: ↑/↓ scroll the
   Horas/Missa text by line (hold-to-repeat comes free from key repeat);
   ←/→ move between days (the `DateNav` function) or between hours.
2. **Softkey bar**: persistent 1-line bar — LSK ("Opções": pick hour/office,
   date, text size), Enter (open chooser / confirm), RSK ("Voltar"). It
   replaces the bottom tab bar; with only Horas and Missa in scope,
   switching sections can be a single softkey menu entry or the 1/2 number
   keys.
3. **Back key**: KaiOS 2.5 fires `Backspace`; unhandled, it exits the app.
   Wire it to close choosers first (the Hours chooser's Escape handler at
   `src/pages/LiturgiaHoras.tsx:435` should also accept Backspace), then
   navigate back, then confirm exit on the root screen.
4. **Keep autoscroll.** Hands-free slow scrolling is a genuinely good fit
   for praying the Hours on a feature phone — back it with the
   packaged-app wake lock (§1 table) so the screen stays on.

### 3.3 Layout & styling at 240×320

1. **Replace flexbox `gap`** (~90 usages) with `space-x/y-*`/margins — on
   Gecko 48 `gap` silently collapses all spacing, so this is correctness,
   not polish. Rebuild the few `grid-cols-*` layouts (calendar, pickers) on
   flexbox. (Option C sidesteps this by not reusing the Tailwind UI.)
2. Shrink the scale: base font sizes, `p-5/p-6` paddings, `rounded-3xl`
   radii are tuned for ≥360 px; QVGA needs a tighter pass. Keep the
   adjustable text size — it matters even more on a small screen.
3. Drop `backdrop-filter`; keep the liturgical-colour theming (CSS custom
   properties work on Gecko 48).
4. Long documents: paginate or virtualise nothing prematurely — Gecko
   handles long static text fine; measure first on the longest office
   (Ofício de Leitura).

### 3.4 Network & data sources

1. `apiapp.glauco.it` (GraphQL) and the `liturgia.pt` ICS are plain HTTPS.
   As a **privileged packaged app with `systemXHR`**, cross-origin
   restrictions vanish — the CORS proxy in `src/lib/liturgy.ts` can be
   bypassed entirely on KaiOS (keep it for the web build).
2. Data frugality (prepaid users): the per-day `localStorage` cache with
   past-day pruning (`src/lib/liturgy.ts:87`) is the right shape; fetch on
   demand only, never background-refetch. Consider prefetching tomorrow
   when today is fetched on Wi-Fi, so the morning office opens instantly.

### 3.5 Reminders & notifications (optional)

With streaks gone, reminders are optional rather than core. If kept: no
service worker means no Web Push — schedule with `navigator.mozAlarms`,
receive via `mozSetMessageHandler('alarm')`, display with the Notification
API, re-arming on each firing (`src/lib/reminderSchedule.ts` logic is
reusable as-is). Reasonable to defer to a later release; a prayer-hours
alarm is a natural fit for the device class.

### 3.6 Storage

`localStorage` for the liturgy cache + persisted settings fits the ~5 MB
quota, with pruning already in place. The ICS cache (full calendar text at
`src/lib/liturgy.ts:326`) is the largest single entry — measure it; move to
IndexedDB if it crowds the quota.

### 3.7 KaiStore distribution

1. `manifest.webapp` with `type: "privileged"`, permissions (`systemXHR`,
   plus `alarms`/`desktop-notification` only if §3.5 ships),
   `default_locale: pt`, launch path, developer info, 56/112 icons.
2. KaiStore has historically required KaiAds SDK integration in free apps;
   request the exemption (religious/non-monetized apps have received it) —
   the SDK loads remote code, which we don't want in a prayer app.
3. Review gate: fully D-pad operable, back-key handled, works offline after
   install (for already-cached days), acceptable start-up time on reference
   hardware.

## 4. Suggested phasing

| Phase | Scope | Outcome |
|---|---|---|
| 0 | Hardware + tooling: 6300 4G device, WebIDE/gDeploy sideloading | Test rig |
| 1 | **Spike Option A**: plugin-legacy build with out-of-scope routes stripped, CSS `gap` fix on the Horas page, polyfills; measure cold start & scroll on device | Go/no-go on the React shell |
| 2 | Shell build-out (A or C per spike): Horas + Missa views, date/hour choosers, D-pad layer, softkey bar, back-key routing | App fully operable without touch |
| 3 | Platform integration: packaged-app manifest + CSP fixes, `systemXHR` (drop CORS proxy), wake lock for autoscroll | Feature-complete on device |
| 4 | QVGA polish, memory/perf tuning, KaiStore submission (manifest, icons, KaiAds exemption); optionally `mozAlarms` reminders | Published |

The web PWA keeps its full feature set; the KaiOS build shares the data
layer (`liturgy.ts`, `breviary/`, `hours.ts`, `dayInfo.ts`) and diverges at
the shell, behind a build mode the main app never pays for.
