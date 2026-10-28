# Plan: commit the planet/horse work, then split `horse.js` into ES modules

Written at the end of the previous session for a fresh session running at **medium effort**. Read `CLAUDE.md` first; it describes the current architecture. Work through the steps in order and don't skip verification.

## Where things stand

- Working tree, all **uncommitted**: tiny-planet world, Epona-style horse with IK legs and walk/trot/gallop, full moon and dusk sky, Gallop toggle button. Modified: `horse.js` (~2,740 lines), `index.html`, `styles.css`. New: `CLAUDE.md`, `.gitignore`. Deleted: `RUN-STATS.md`, which was intentional.
- The user's global rules: never push, and ask before committing.
- No build step, tests or linter. Verification is by browser screenshots plus a keyboard drive (see "QA script" below).

## Token budget (user has limited usage left)

- **Don't Read all of `horse.js`.** It's ~30k tokens. Use the line ranges below, plus `grep -n` and `sed -n 'a,bp'` for spot checks.
- **Move code mechanically with one Python script** that slices line ranges into the new files. Don't retype code through Write or Edit. Then hand-edit only the import/export headers.
- Use the `no-undef` lint (step 4) to find missing imports, instead of reasoning about every identifier.

---

## Step 1: Commit the current work (ask the user first)

```bash
git add -A && git status --short
git commit -m "feat: tiny-planet world, Epona-style horse with IK gaits, full moon, gallop toggle"
```

End the message with the attribution line the harness gives. Don't push.

## Step 2: Take baseline screenshots before touching code

```bash
python3 -m http.server 8765   # in background, from the repo root
```

Run the QA script below with `BASE=1`. It writes `base-*.png` to your scratchpad. Use the **reduced-motion** shots for the before/after comparison, because the horse stands still and no particles spawn there. Normal-motion shots vary with time because she's wandering.

## Step 3: Split `horse.js` into modules under `src/`

Line numbers below are for the committed `horse.js`. Before cutting, re-check them with:

```bash
grep -n "^/\* [A-Z].*\*/$\|^function " horse.js
```

| New file | Take from `horse.js` | Contents | Notes |
|---|---|---|---|
| `src/util.js` | 6–39, 224–235 | `clamp damp lerp fract wrapAngle wrapCycle smoothstep`, `mulberry32`, `random`, `randomDirection`, `X_AXIS`, `Y_AXIS`, `makeGlowTexture` | Pure. `random` is the single seeded stream. Export all. |
| `src/core.js` | 3–4, 41–66 | `prefersReducedMotion`, `stage`, `renderer`, `scene`, `camera`, `PLANET_RADIUS`, `CAMERA_AZIMUTH` | `renderer` is a `let` assigned in a try/catch. Change it to `export const renderer = createRenderer()`, where `createRenderer` keeps the WebGL error message. |
| `src/sky.js` | 68–223 and 237–411 (that is, 68–411 minus `makeGlowTexture`) | `skyFrame`, `skyDirection`, `SUN_/MOON_/MOONLIGHT_DIRECTION`, sky dome, `stars`, moon and halo, `placeMoon`, mini-worlds, `hemi`, `sun`, `moonLight` | Calls `random()` at load (stars, moon craters). |
| `src/planet.js` | 413–875 | noise, `planetDirection`, `placeOnPlanet`, `layout`, `obstacles`, planet mesh, atmosphere, `castAndReceive`, `fadeables`/`makeFadeable`, trees, baobab, volcanoes (`smokeVents`), rose, `sphereLowGeometry`, bushes, stones, `clearOfObstacles`, grass and flowers | Calls `random()` at load. |
| `src/effects.js` | 877–937, 2630–2641 | `softPuffTexture`, `makePuffPool`, `particlesEnabled`, `dust`, `smoke`, `emitPuff`, `updatePuffs`, `updateSmoke` | |
| `src/geometry.js` | 939–1243 | `catmullRom`, `sampleKeys`, `makeSweep`, `tubeGeometry`, `hairRibbonGeometry`, `limbGeometry`, `mergeGeometries`, `makeDynamicTube` | Pure. |
| `src/horse/body.js` | 1245–1782 | materials, `sphereGeometry`, `horse`, `torso`, `ellipsoid`, `addMesh`, `torsoShape`/`torsoSurface`/`torsoPadGeometry`, saddle, `reinAnchors`, neck (`neckGroup`, `neckSweep`), head (`HEAD_PITCH`, `headGroup`, `headSweep`), blaze, eyes, ears (`ears`), bridle, `bitRings`, mane (`maneLocks`, `forelockLocks`), tail (`tailBones`), `reins` | Adds `horse` to the scene. |
| `src/horse/legs.js` | 1783–1974 | leg constants, `hoofGeometry`, radii, `addLowerLeg`, `makeLeg`, `legs`, `solveTwoBone`, `solveLegPose`, `applyLegPose` | |
| `src/horse/motion.js` | 1976–2051 (state through `const pressed`), 2261–2577 | `state`, `pressed`, `GRAVITY`, `BODY_LIFT`, `HORSE_RADIUS`, `FRAME_HEADING`, horse vectors (`horseUp`, `horseForward`, `horseSide`, `previousUp`), `placeHorse`, `GAITS`, `gait`, `gallopSpeed`, `requestJump`, `avoidObstacles`, `resolveCollisions`, `updateLocomotion`, `groundHeight`, `solveFromHorse`, `plantAt`, `land`, `updateGait`, `updateLegs`, `updateReins`, `updateBody` | `pressed` lives here so `ui.js` can import it without an import cycle. |
| `src/camera.js` | 2166–2252, 2578–2628, 2643–2666, 2712–2729 | `frameForViewport`, `orbit`, `userZoomed`, frame vectors, `cameraTarget`, pointer and wheel handlers, `updateCamera`, `blocksView`, `updateFades`, `resize` | `placeMoon(initialFrame.moon)` runs here at load. |
| `src/ui.js` | 2053–2164, 2668–2686 | DOM lookups, music, pace slider, `setAuto`, `setGallop`, keyboard handlers, `updateReadout` with `gaitText`/`paceText` | |
| `src/main.js` | 2257 (`clock`), 2688–2707, 2731–end | `animate`, the resize listener, boot (`land(); updateGait(0); updateLegs(); setAnimationLoop`), `is-ready` | Entry point. |

Line 2258–2259 (`gaitText`, `paceText`) go to `ui.js`. Lines 2261–2263 (`toObstacle`, `pushAxis`, `pushRotation`) go to `motion.js`.

**Rules for the split:**

1. **Keep the seeded layout identical.** `random()` is consumed at load time by `sky.js` (stars, moon texture) and then by `planet.js` (noise tables, stones, grass, flowers). ES modules evaluate dependencies first, in the order of the import statements. So `main.js` must import `sky.js` **before** `planet.js`, and no module that calls `random()` at load may be evaluated in between. Use this import order in `main.js`: `core → sky → planet → effects → geometry → horse/body → horse/legs → horse/motion → camera → ui`.
2. **No import cycles.** The dependency direction is util → core → sky/planet/effects/geometry → body → legs → motion → camera → ui → main. `camera.js` may import from `motion.js` (horse vectors, `BODY_LIFT`) and from `planet.js` (`fadeables`), but never the reverse.
3. **Share state through exported `const` objects** that get mutated (`state`, `gait`, `orbit`, vectors). Don't reassign exported bindings from other modules. `gait.weights = ...` reassigns a property, which is fine.
4. **Change no behaviour or numbers.** This is a pure move plus import/export lines. Keep the existing comments and banners.
5. **`index.html`:** change the script tag to `<script type="module" src="src/main.js">`. The import map entry `three → ./vendor/three.module.js` still resolves from `src/`, so keep it unchanged. Then `git rm horse.js`.

## Step 4: Static check for missing imports

```bash
for f in src/*.js src/horse/*.js; do node --check "$f" || echo "SYNTAX $f"; done
npx -y eslint@8 --no-eslintrc --env browser,es2022 \
  --parser-options ecmaVersion:2022,sourceType:module \
  --rule '{"no-undef":"error","no-unused-vars":"warn"}' src
```

Fix every `no-undef` by adding an import or export. An unused export can be left alone.

## Step 5: Verify in the browser

Run the QA script normally, then with `BASE=1` already done, compare:

- **Console:** no errors at any size.
- **Reduced motion:** `rm-*.png` should look identical to `base-rm-*.png` at the same size, with the same tree and volcano positions, moon position and star field. If the scenery moved, the `random()` order changed (rule 1).
- **Driving:** the gait readout should go `gallop` (Gallop button), then `gallop` (W with the button on), then `walk` (button off), then `jump` (Space), then `standing` (keys released).
- **Layout:** the dock should have no overlap at 320/375/390 px; check the screenshots.

## Step 6: Update docs and commit (ask first)

- In `CLAUDE.md`, replace "a single module of top-level imperative code" and the "horse.js" heading with the module map (one line per file) and the import-order rule about the seeded `random()`. Update the `index.html` script path mention. Keep the rest.
- Commit with `refactor: split horse.js into ES modules (no behaviour change)`. Don't push.
- Delete `PLAN.md` in that commit, or ask the user whether to keep it.

---

## QA script

Save this to your scratchpad as `qa.mjs`. Run it with `node qa.mjs` for the after-split shots, or `BASE=1 node qa.mjs` for the baseline. It needs the server on :8765. Playwright comes from the npx cache, using the system Chrome.

```js
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/chiko/.npm/_npx/9833c18b2d85bc59/node_modules/playwright");
const prefix = process.env.BASE ? "base-" : "";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const errors = [];
async function open(w, h, reduced = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`${w}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${w}: ${e.message}`));
  await page.goto("http://localhost:8765/index.html", { waitUntil: "load" });
  await page.waitForTimeout(2000);
  return page;
}
for (const [w, h] of [[1440, 900], [768, 1024], [390, 844], [320, 640]]) {
  await (await open(w, h, true)).screenshot({ path: `${prefix}rm-${w}.png` });
  await (await open(w, h)).screenshot({ path: `${prefix}live-${w}.png` });
}
const p = await open(1280, 800);
const gait = () => p.textContent("#gaitValue");
const log = [];
await p.click("#gallopButton"); await p.waitForTimeout(2500); log.push(await gait());
await p.keyboard.down("KeyW"); await p.waitForTimeout(1500); log.push(await gait());
await p.click("#gallopButton"); await p.waitForTimeout(2500); log.push(await gait());
await p.keyboard.press("Space"); await p.waitForTimeout(250); log.push(await gait());
await p.keyboard.up("KeyW"); await p.waitForTimeout(2500); log.push(await gait());
console.log("drive:", log.join(" → "), "(expect gallop → gallop → walk → jump → standing)");
console.log(errors.length ? errors.join("\n") : "no console errors");
await browser.close();
```

## Backlog (only if the user asks; not part of this plan)

- Mane still reads slightly "ribbon-like" up close. Try more, thinner locks, or a skinned mane like the tail.
- An option for the sky to stay world-fixed, so the stars wheel as she circles the planet. Today it follows her heading on purpose.
- A keyboard shortcut for the Gallop toggle, for example `G`.
