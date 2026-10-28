# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running

There is no build step, package.json, linter, or test suite. It's a static page: `index.html` + `styles.css` + `horse.js`, with Three.js r170 vendored at `vendor/three.module.js`.

It has to be served over HTTP, because the ES module and import map don't load from `file://`:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

Check changes in a real browser. Look for console errors and horizontal overflow, and test both desktop and phone sizes (earlier QA used 1440×900, 768×1024, 390×844, and 375×812). The planet's layout uses a seeded PRNG (`random()`, seed 612), so scenery is identical on every load. Dust and smoke jitter use `Math.random()`, and the horse wanders from the moment the page loads, so screenshots taken at different times won't match.

If the page stays on "Letting the horse in…", `horse.js` threw before reaching the boot code at the bottom. The loader covers the page (`z-index: 20`) until `body.is-ready` is added there, so check the console.

`assets/*.mp3` is gitignored. In a fresh clone `assets/opening-theme.mp3` is missing, and the Music button fails silently because the `play()` rejection is caught.

## Dependencies

- `three` resolves through the import map in `index.html` to `./vendor/three.module.js`. Only the core build is vendored, so `three/addons/...` imports (OrbitControls, BufferGeometryUtils, loaders, etc.) won't resolve. Either vendor the file and add an import-map entry, or write the feature by hand. The orbit camera and `mergeGeometries` are already written by hand for this reason.
- The only network dependency is Google Fonts (Fraunces and Karla).

## horse.js architecture

It's a single module of top-level imperative code that builds the scene in this order: renderer → sky frame (sky dome shader, stars, moon sprites, two distant mini-worlds, lights) → planet (a vertex-coloured icosphere plus an atmosphere halo) → scenery → dust/smoke pools → geometry helpers → horse → state and input → camera → animation loop → boot. Everything is procedural. There are no model files.

**The world is a tiny sphere** (`PLANET_RADIUS`). The horse's placement is two unit vectors: `horseUp` (the surface normal) and `horseForward` (a tangent). To move, both vectors rotate about `horseSide` by `speed * dt / R`. To turn, `horseForward` rotates about `horseUp`. `placeHorse()` builds the `horse` group's transform from that basis, so the `horse` group's local space is always the ground frame under her. To place scenery relative to the start point (the north pole), use `planetDirection(arc, bearing)` with `placeOnPlanet()`. Anything solid goes in `obstacles` (`{ direction, radius }`), which `resolveCollisions()` pushes her out of and `avoidObstacles()` steers wander around. Large scenery goes through `makeFadeable()`, which clones its materials so `updateFades()` can fade it when it's between the camera and the horse.

**Sky, lights and camera all live in one moving frame, not world space.** The frame is `cameraUp` plus `cameraHeading`. The heading is carried along the surface as she walks and slowly swung after her heading (`FRAME_HEADING`). `skyFrame` (sky dome, stars, moon, mini-worlds) is re-posed to this frame every frame. The sun, moonlight and hemisphere lights are re-aimed from it, and `orbit` azimuth and polar angle are measured in it. So `SUN_DIRECTION`, `MOON_DIRECTION` and `MOONLIGHT_DIRECTION` are frame-local, and the moon stays in the same place on screen unless the user orbits. `placeMoon()` puts the moon somewhere different for each viewport shape (`frameForViewport().moon`).

**Rig hierarchy.** `horse` (ground frame) → `torso` (bob, pitch, roll and `BODY_LIFT`; pitch is compensated so it pivots about the barrel), which carries the tack, the legs, `tailGroup` and `neckGroup` → `headGroup`. The barrel comes from `torsoShape()`. The saddle, blanket and girth are pads built with `torsoSurface(zc, beta, lift)`, so they follow the barrel if its shape changes. The neck and head are `makeSweep()` bodies. Everything that sits on them (mane locks, forelock, blaze strip, bridle straps, eyes, ears, bit rings) is positioned with `sweep.point(t, angle, lift)`, so changing a sweep's keys moves its decorations with it. Angle 0 is +x, which is the horse's **left**; π/2 is the top line. The tail is four `SkinnedMesh`es sharing `tailSkeleton` (bones along `tailCurve`). Only the bone rotations are animated.

**Legs are solved with IK.** Each leg is a chain of Groups: `root` (at `pivot`, Euler order `ZXY`, with rotation.z used for sideways tilt) → `middle` → `lower` → `fetlock` → `coffin`. `solveLegPose()` turns a toe target and a hoof angle into a 7-number pose: `[tilt, slide, root, middle, lower, fetlock, coffin]`. Angles are measured from straight down, and positive swings backward, which matches `rotation.x`. The front leg bends at a hidden elbow and folds its knee. The hind leg solves femur and tibia to the hock, with the cannon angle derived from the overall leg angle. How each phase is posed:
- **Stance:** the toe stays on a planted world point (`leg.plant`) and is re-solved every frame, which is why hooves don't slide.
- **Swing:** the pose interpolates from `liftPose` to the IK pose for the landing spot, plus `leg.fold` times a fold curve.
- **Airborne:** the pose blends toward `leg.tuck`.
- **Standing:** the pose blends toward `neutralPose` as `gait.activity` drops.

If you change segment lengths or pivots, the rest pose follows automatically.

**Gait.** The `GAITS` table (walk, trot, gallop) gives each gait a duty factor and per-leg phase offsets, in leg order **LH, LF, RH, RF**. Gait weights blend by speed. Stride frequency is `speed * duty / stanceLength`, which is what keeps planted hooves from sliding. Each leg's offset is rate-limited toward the dominant gait's offsets, so gait changes don't snap. `updateBody()` derives torso bob, pitch and roll, the head nod, mane bounce and the tail from `gait.phase` and the weights. A jump is a short `crouch`, then ballistic `air` (`state.height` along `horseUp`), then `land()`, which re-plants every hoof.

## JS ↔ HTML/CSS contract

- `horse.js` looks up elements by id: `stage`, `paceValue`, `paceInput`, `paceOutput`, `gaitValue`, `wanderButton`, `gallopButton`, `soundButton`, `themeAudio`, `loader`, plus `.loader p` for the WebGL error message. Renaming any of these in `index.html` breaks the script. JS sets the slider's starting value from `state.cruise`. Its range (0.6–3.4) spans walk into trot, because trot starts at about 2 m/s.
- Toggle state is stored in `aria-pressed`, and the CSS selects on it (`.wander[aria-pressed="false"]`, `.sound[aria-pressed="true"]`, `.gallop[aria-pressed="true"]`). The Gallop toggle (`state.gallop`) does the same as holding Shift. Change state through that attribute, not through classes.
- The HTML UI sits on top of the full-bleed `#stage` canvas. `.vignette`, `.masthead`, `.meter`, and `.dock` are `pointer-events: none` so that drags reach the canvas, and only `.actions` turns pointer events back on. Any new interactive overlay needs `pointer-events: auto`, or it won't receive clicks. `#stage` sets `touch-action: none` so orbiting works on touch screens.
- Text drawn directly over the night sky uses the `--sky-ink*` and `--sky-accent` tokens, with `--sky-shadow`. The cream glass panels (`.meter`, `.actions`, `kbd`, `.pill`) keep the `--ink*` tokens. The `--night` token is the page and loader background.
- After two animation frames, `body.is-ready` is added. That triggers the entrance transitions for `.masthead`, `.meter`, and `.dock`, which start at `opacity: 0`, and hides the loader. A new overlay that copies that starting style also needs its own `.is-ready` rule. `#stage.is-dragging` sets the cursor. JS writes the slider fill to the `--fill` custom property on `#paceInput`.
- Under `prefers-reduced-motion`, JS starts with wander off and creates no dust or volcano smoke, and stars don't twinkle. CSS skips the entrance animations.
- Keyboard: any movement key (WASD or arrows) turns wander off. Space jumps, unless focus is on a button or link. Either Shift gallops. Buttons and the slider blur on `pointerup` (when `event.detail > 0`) so that keys keep reaching the window.
