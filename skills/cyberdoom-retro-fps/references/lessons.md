# Lessons

Bugs and dead ends from the reference build, and the invariants that keep them fixed. Treat this as
a regression checklist, not history trivia.

## 1. Import validation must reject, not clamp

**Symptom:** the self-test “Save validator rejects malformed input” failed (16/17). A payload
`{level: 99}` was clamped to the last valid level and imported.

**Cause:** `sanitiseNumber(input.level, -1, 0, LEVELS.length - 1)` always returns a number in range,
so the “invalid” branch was unreachable.

**Fix:** validate the raw value before clamping:

```js
const rawLevel = Number(input.level);
if (!Number.isInteger(rawLevel) || rawLevel < 0 || rawLevel >= LEVELS.length) return null;
```

**Regression risk:** any new save field that uses `sanitiseNumber` directly will silently accept
garbage. Validate identity/type first, clamp only magnitudes. `sanitiseRun` must return `null`, never
a partial run.

## 2. Pointer lock can reject its promise

**Symptom:** headless Chrome logged `Uncaught (in promise) WrongDocumentError` and a console error.

**Cause:** Three.js r128 `PointerLockControls.lock()` ignores the promise returned by
`requestPointerLock()`. A headless or cross-origin document cannot lock, so the rejection surfaced.

**Fix:** detect `navigator.webdriver` / `HeadlessChrome` in `Game.isHeadless`, skip lock requests
there, and replace `controls.lock` with a wrapper that catches a rejected request.

**Regression risk:** removing the wrapper brings back an unhandled rejection in embedded/automated
contexts. Never call `requestPointerLock()` without a user gesture or without a catch.

## 3. Mobile HUD overflow

**Symptom:** at 390×844 the weapon stage measured ~452 px wide with `left: -31px`, producing a
horizontal scrollbar and clipped status bar.

**Cause:** the weapon canvas and HUD spacing were sized for desktop; the status bar grid did not
collapse cleanly.

**Fix:** media queries at 1120/900/680/420 px, a smaller weapon stage, wrapping status cells and
hiding the face panel at narrow widths. Final check: `innerWidth === scrollWidth === 390`.

**Regression risk:** any fixed pixel width added to the HUD or touch UI can reintroduce overflow.
Test 390×844 after every CSS change.

## 4. Shared sprite textures animate together

**Symptom:** every enemy of a type changed animation frame at once.

**Cause:** `SpriteMaterial.map` pointed at the same cached atlas texture; `texture.offset.x` is a
property of the texture, not the sprite.

**Fix:** `Enemy.build()` clones the cached atlas per instance before setting
`texture.repeat.set(1/3, 1)` and `texture.offset.x = frame/3`.

**Regression risk:** caching textures is good; sharing mutable animation state is not. Clone per
animated instance.

## 5. Sprite anchor and wall matrices

- Enemy sprites must use `center.set(0.5, 0)` so `position.y` is the feet anchor; the default centre
  anchor makes the enemy float or sink.
- Static walls should call `updateMatrix()` then set `matrixAutoUpdate = false`. Otherwise every wall
  recomputes its matrix each frame.
- `PlaneGeometry` signs need `FrontSide` and a rotation matching the wall normal, or they vanish from
  one side.

## 6. Shared glow textures must not be disposed per projectile

**Symptom:** later projectiles/pickups lose their glow after the first one is destroyed.

**Cause:** projectile/pickup `dispose()` disposed `glowMaterial.map`, which is a cached texture owned
by `Game.assets.glow`.

**Fix:** dispose the material, not the cached map. `Projectile.dispose` explicitly leaves the glow
map alive.

**Regression risk:** the same trap applies to enemy atlas textures, wall textures and shared
geometries. Track ownership.

## 7. Autosave must not survive the end of a run

**Symptom:** “Continue Run” resumed a cleared or dead run.

**Cause:** the last autosave remained in localStorage after level clear, victory or death.

**Fix:** `safeRemove(STORAGE_KEYS.autosave)` in `completeLevel`, `showVictory` and `showGameOver`;
`updateContinueButton()` disables the button when no valid run exists.

**Regression risk:** adding a new terminal state (e.g. “abandon run”) must also clear the autosave.

## 8. Seeded structure, unseeded cosmetics

**Symptom:** a reloaded save had the same walls but crates/barrels in slightly different positions.

**Cause:** the grid uses `mulberry32(seed)`, but prop offsets use global `Math.random`; props are also
collision obstacles.

**Status:** accepted limitation, documented. Do not promise exact prop restoration. If exact restore
is required, store prop offsets (and obstacle radii) in the run object and validate them on import.

Related edge case: `sanitiseRun` clamps `seed` to ≥ 1, so a run generated with seed 0 reloads as seed
1. Fix by allowing 0 explicitly if this matters; the chance is 1 in 2³².

## 9. “Attack” is not a state

The README and brief describe `idle → patrol → alert → chase → attack → dead`. The source has no
`attack` state; firing and melee are branches in `chase` gated by `attackRange` and `attackTimer`.
Do not add an `attack` state just to match the prose unless you also add transitions, re-planning and
tests. Document the code that exists.

## 10. The renderer is not a raycaster

The brief calls it a raycast shooter. The implementation is Three.js geometry, a perspective camera,
billboard sprites and a hitscan (`rayWallDistance` + `THREE.Ray.intersectBox`). Do not rewrite it into
a per-column raycaster to satisfy the label; that would change the art, collision, performance and
save assumptions. Explain the distinction in the docs.

## 11. A blocked CDN is a hard failure

Three.js is loaded from cdnjs; without it, `Game.init` calls `fatal()` and shows “RENDER CORE
OFFLINE”. PointerLockControls comes from jsDelivr; without it the code falls back to
`FallbackPointerControls`, but pointer lock itself still depends on the browser. Fonts are optional
and fall back to system stacks. Never claim the project is offline-ready.

## 12. The self-test is browser-only

`Game.selfTest()` needs `THREE`, WebGL, the DOM and `AudioContext`. It cannot run in Node. The static
check script proves files, links, syntax, JSON and template identity; it cannot prove rendering,
pointer lock, audio output or touch. Keep the two verification layers separate and label results
honestly.

## 13. Build artefacts are not the source layout

The game was authored as seven temporary `src/*.js` chunks and concatenated into `script.js` with
`cat`. The `src/` directory is not part of the release. If you split the file again, either keep a
checked-in concat step or edit `script.js` directly; do not leave a stale generated copy that looks
authoritative.

## 14. Small traps that cost time

- `safeSet` returns `false` in private mode; the game must continue in memory. Do not throw.
- `Vector3`/`Euler` objects are reused on purpose; avoid allocating per-frame in hot paths.
- `renderer.setPixelRatio(1)` plus CSS `image-rendering: pixelated` is the retro look. Setting DPR to
  `devicePixelRatio` makes it sharp and slower.
- FOV kick changes the camera FOV; always call `updateProjectionMatrix()`.
- `MAX_DT` is a clamp, not a fixed timestep. A slow tab slows the game; do not add catch-up steps
  without re-testing collision tunneling.
- `beforeunload` autosave must be synchronous; localStorage is.
- Touch `pointerup`/`pointercancel`/`lostpointercapture` all need to release the stick or look zone.
- The pause screen must clear keys and touch state; otherwise the player keeps moving after resume.
- The `fatal` screen must stop the boot loop cleanly; a missing Three.js must not spam exceptions.
- `state.json` is historical. Do not read it at runtime or rewrite it to “look current”.
