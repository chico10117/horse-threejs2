# AGENTS.md

Static Three.js page (no `package.json`, no build step). Entry is `index.html` → `src/main.js`; Three.js r170 is vendored at `vendor/three.module.js`. Deeper rig/leg/gait/camera notes live in `CLAUDE.md`; read it before changing horse or planet internals.

## Run and verify

Serve over HTTP (the ES module and import map do not load from `file://`):

```bash
python3 -m http.server 8000   # http://localhost:8000
```

CI runs these exact checks (`.github/workflows/ci.yml`):

```bash
# syntax
for f in src/*.js src/horse/*.js tests/*.mjs; do node --check "$f"; done

# lint (no local config; pinned ESLint)
npx --yes eslint@8.57.1 --no-eslintrc --env browser,es2022 \
  --parser-options ecmaVersion:2022,sourceType:module \
  --rule '{"no-undef":"error","no-import-assign":"error"}' src

# smoke test (Playwright is NOT a repo dependency)
npm install --no-save --no-package-lock playwright@1.49.1
npx playwright install chromium
BASE_URL=http://localhost:8765/ node tests/smoke.mjs
```

There are no unit tests. `tests/smoke.mjs` checks boot, console errors, no horizontal overflow at 1440×900 and 390×844, and that Space still jumps after clicking Gallop.

Deploy: CI assembles `_site/` from `index.html styles.css src vendor assets` only. New top-level runtime directories must be added to that copy step or Pages will 404 them.

## Architecture

- Each module is top-level imperative code sharing state through exported, **mutated** `const` objects (`state`, `gait`, `orbit`, horse vectors). Never reassign another module's export.
- **Import order is load-bearing.** `main.js` imports `sky.js` then `planet.js` because both draw from the seeded `random()` (seed 612) at load. Any module calling `random()` at load must not evaluate between them, or the planet's scenery rearranges.
- Dependencies point one way: util → core → sky/planet/effects/geometry → body → legs → motion → camera → ui → main.
- Only the Three core build is vendored, so `three/addons/...` imports (OrbitControls, BufferGeometryUtils, loaders) will not resolve. Hand-write the feature or vendor the file and add an import-map entry; orbit controls and `mergeGeometries` are already hand-written.
- The world is a tiny sphere; horse position is `horseUp` + `horseForward` unit vectors, and sky, lights, and camera live in a moving frame rather than world space. Details in `CLAUDE.md`.

## JS ↔ HTML/CSS contract

- `src/ui.js` looks up elements by id (`stage`, `paceInput`, `wanderButton`, `gallopButton`, `soundButton`, `themeAudio`, `loader`, …). Renaming ids in `index.html` breaks the script silently.
- Toggle state lives in `aria-pressed` and CSS selects on it. Change state through the attribute, not by adding classes.
- Overlays are `pointer-events: none` so drags reach the canvas; only `.actions` re-enables pointer events. New interactive overlays need `pointer-events: auto`.
- `body.is-ready` is added after two animation frames; it hides the loader and starts entrance transitions. A new overlay with an initial `opacity: 0` needs its own `.is-ready` rule.

## Gotchas

- Scenery is deterministic (seeded PRNG) but screenshots are not: the horse wanders from load and dust/smoke jitter use `Math.random()`.
- Stuck on "Letting the horse in…" means a module threw before boot; check the browser console (loader sits at `z-index: 20` until `body.is-ready`).
- If `assets/opening-theme.mp3` is missing, the Music button fails silently because the `play()` rejection is caught.
- Under `prefers-reduced-motion`, wander starts off, dust/volcano smoke are not created, and stars stop twinkling.
