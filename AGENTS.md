# AGENTS.md — CYBERDOOM

> **Start here for handoff:** [docs/REPRODUCTION.md](docs/REPRODUCTION.md) is the rebuild and
> verification book. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) maps the code and formulas.
> [docs/TESTING.md](docs/TESTING.md) records what was actually run.

## 1. What this is

A static, client-side retro first-person shooter: one HTML page, three source files, no build step
and no backend. It generates three seeded cyber-industrial sectors, renders them with Three.js r128
and billboard sprites, and runs a complete combat → purge → exit loop with two hitscan weapons, three
enemy archetypes, procedural Canvas 2D art, synthesised Web Audio, a Doom-style status bar,
`localStorage` autosave and JSON save export/import. Current release: **v1.0.0** (`2026.10.31`).

It is **not** a software raycaster, not multiplayer, not server-backed, not offline-capable (Three.js
and fonts come from CDNs), and not a framework starter. The "raycast" in the brief is hitscan
verification against enemy hitboxes; the view is real 3D geometry.

Live copy: <https://somphol.github.io/cyberdoom-retro-fps/>
Self-test: <https://somphol.github.io/cyberdoom-retro-fps/?selftest=1>
Local master: `~/Projects/cyberdoom-retro-fps`

## 2. Commands

```bash
# run (no install, no build)
cd ~/Projects/cyberdoom-retro-fps
python3 -m http.server 8000
# open http://localhost:8000 — serve over HTTP, not file://

# verification
node --check script.js
node scripts/check.mjs
node ~/.config/opencode/skills/skill-publish/scripts/check-skill.mjs skills/cyberdoom-retro-fps
# in the browser: http://localhost:8000/?selftest=1  → 17/17

# deploy = push to main; Pages serves the repo root
git push origin main
```

`scripts/check.mjs` is dependency-free: required files, local `src`/`href` references, relative
Markdown links, `node --check` for every JS file, JSON parsing, and byte-identity of the skill
template. It prints `OK <n> checks`. There is no `npm install`, build or CI workflow.

## 3. Architecture

Load order: Google Fonts → `style.css` → Three.js r128 → PointerLockControls → `script.js`. The
script is one IIFE; declaration order matters:

1. Constants/helpers (`CELL = 2.8`, `WALL_H = 3.7`, `EYE_HEIGHT = 1.62`, `PLAYER_RADIUS = 0.42`,
   `GRAVITY = 19.5`, `JUMP_SPEED = 6.4`, `WALK_SPEED = 5.4`, `SPRINT_SPEED = 7.4`, `MAX_DT = 0.05`,
   `mulberry32`, safe-storage helpers, `sanitiseNumber`).
2. `SynthEngine` + `audio`; `WEAPONS`, `ENEMY_TYPES`, `LEVELS`, `PICKUP_TYPES`.
3. `TextureFactory` (Canvas 2D), `ParticleField` (280-point pool), `TracerPool` (20-line ring).
4. `DungeonLevel`: `grid[z][x]` (0 open, 1 wall); `carveMaze`, `carveRooms`, `braidMaze`,
   `sealBorder`, `chooseStartAndExit`, `computeDistances`, `openCells`; collision, LOS, A*; meshes,
   props, lights, signs, portal.
5. `Enemy`, `Projectile`, `Pickup`; `HUD`; `sanitiseRun`; `FallbackPointerControls`; `Game`.
6. Boot: `new Game()` → renderer/camera/scene → controls → lights → particles/HUD → events → title →
   loading bar → `requestAnimationFrame(animate)`.

`Game.animate` clamps `dt` to `MAX_DT`, calls `update(dt)`, then `renderer.render(scene, camera)`.
`update` order in `playing`: player physics → weapons → enemies → projectiles → pickups → portal →
exit check → HUD → autosave.

Key formulas:

```text
worldX = (gx + 0.5) * CELL - half;  half = size * CELL / 2
gx     = floor((x + half) / CELL)
damp(a,b,λ,dt) = lerp(a,b,1-exp(-λdt))
hitscan wall march: t = 0.15 .. min(range, floorT, ceilT) step 0.1
shotgun falloff = clamp(1 - distance/range * 0.45, 0.52, 1)
armour absorbs min(armor, incoming * 0.58)
```

Map format and save schema are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §4 and §10. Runtime
state: `Game.mode`, `player`, `weapons`, `score/kills/shotsFired/shotsHit`, `levelIndex/levelSeed`.
localStorage keys: `cyberdoom.autosave.v1`, `cyberdoom.highscores.v1`, `cyberdoom.settings.v1`.
Autosave is the run object `{schema, version, savedAt, level, seed, player, weapons, stats, enemies,
pickups}`; the download wraps it as `{format:'cyberdoom-save', schema:1, version, exportedAt, run,
highScores, credits}`. `sanitiseRun` is a strict whitelist.

## 4. Decisions and constraints

- **Three files, no build.** `index.html` + `style.css` + `script.js`; anything that adds a bundler,
  package manager, service worker or framework is out of scope.
- **Three.js r128 is pinned.** The code uses r128 globals and `sRGBEncoding`; changing the CDN
  version requires a real migration, not a URL edit. PointerLockControls is pinned to 0.128.0.
- **CDN + fonts are runtime dependencies.** The project is not offline. If Three.js is blocked the
  game shows the fatal screen; if fonts are blocked the CSS stacks fall back.
- **World constants are coupled.** `CELL`, `WALL_H`, `EYE_HEIGHT`, `PLAYER_RADIUS` and the
  `grid[z][x]` convention are assumed by collision, props, portal, camera, minimap and saves. Change
  them together and re-test corners, spawn, exit and mobile.
- **Hitscan must stay wall-limited.** `shotRay` computes `rayWallDistance` first and only accepts an
  enemy closer than that. The 0.1 grid march is deliberate; do not replace it with an unclipped
  `Raycaster` without re-testing wall occlusion.
- **All art and audio are procedural.** No binary textures, sprites, fonts or sounds are bundled.
  Enemy textures are cloned per instance so each can animate its own atlas offset.
- **Enemy behaviour is `idle → patrol → alert → chase → dead`.** Attacking is a branch inside
  `chase`, not a separate state. Alert propagation radius is 8.5; chase forgets after 3.2 s.
- **Saves are small and partial.** The grid is regenerated from `level + seed`; prop offsets use
  `Math.random` and are not saved. Do not promise exact prop-position restoration.
- **Import is whitelist-only.** `sanitiseRun` returns `null` or a fully clamped run; never apply a
  partial payload. Keep the level check a strict integer in `[0, 3)`.
- **Autosave clears at run end.** `completeLevel`, `showVictory` and `showGameOver` remove it so
  Continue cannot resume a finished run.
- **`state.json` is historical.** It records the build session, timing and tokens; never read it at
  runtime or refresh it to hide history.
- **Documentation and the skill ship with the code.** Update docs, `scripts/check.mjs` and
  `skills/cyberdoom-retro-fps/assets/template/` whenever a source file changes.

## 5. Known issues

- **Not offline.** Three.js, PointerLockControls and Google Fonts load from CDNs.
- **No CI.** `scripts/check.mjs` is local; the 17 self-tests run only in a browser. There is no
  checked-in headless harness.
- **Browser coverage is Chrome.** Desktop and headless Chrome with SwiftShader were exercised;
  Firefox and Safari were not formally automated.
- **Mobile was verified in portrait only** (390×844, touch emulation). Landscape/tablets and real
  touch hardware are untested.
- **Save fidelity is partial.** Prop offsets are random per load; enemy patrol paths and alert
  timers are not saved. A seed of 0 reloads as 1 because `sanitiseRun` clamps to ≥ 1 (1 in 2³²).
- **Pointer lock is skipped in headless** (`navigator.webdriver` / `HeadlessChrome`) so real mouse
  capture is not covered by automated runs. Some embeds/iframes block pointer lock entirely.
- **Audio needs a gesture** and its timbre varies by browser. Headless checks only prove the API
  exists.
- **Accessibility is incomplete.** The canvas has a label, but there is no keyboard-only aiming,
  screen-reader world model or modal focus trap.
- **Performance is environment-specific.** ~194 draw calls / ~3,684 triangles / ~57 FPS was recorded
  at 1600×1000 under SwiftShader; real GPU results differ.
- **`setPixelRatio(1)` and low internal resolution are intentional.** Do not “fix” the pixelation.

## 6. Continuity

- **Deployed copy:** GitHub Pages, `main`, repository root, `.nojekyll`. Live URL above. Before a
  push, compare the local and live `script.js` SHA-256; after a push, verify root, `style.css`,
  `script.js`, `favicon.svg` and `state.json` return 200 and `?selftest=1` reports 17/17.
- **Local master:** `~/Projects/cyberdoom-retro-fps`.
- **History:** `CHANGELOG.md` is the release log; `state.json` / `STATE.md` are the v1.0.0 build
  record (30m 51s, 733,525 tokens, OpenCode 2.2.5, DeepSeek V4.1 Flash).
- **Documentation map:** [README.md](README.md) is the human entry point; [AGENTS.md](AGENTS.md) is
  this handoff; [docs/REPRODUCTION.md](docs/REPRODUCTION.md) is the rebuild book;
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the module/formula map;
  [docs/TESTING.md](docs/TESTING.md) is the verified matrix and gaps;
  [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) is Pages operations;
  [skills/cyberdoom-retro-fps/SKILL.md](skills/cyberdoom-retro-fps/SKILL.md) is the reusable build
  skill. Policies: [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md),
  [SECURITY.md](SECURITY.md), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [LICENSE](LICENSE).
- **Publishing rules:** keep the repository public (MIT), Pages on `main` / `/`, `.nojekyll` present,
  no force-push, no secrets or `.env`, and never copy `~/opencode-transcripts` material into the
  repository. If the repository is renamed, update the absolute URLs in `index.html` (canonical/OG),
  `README.md`, this file, `robots.txt`, `sitemap.xml` and `state.json`.
