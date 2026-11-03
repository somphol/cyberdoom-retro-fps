# Reproduction book

This is the rebuild and verification book for **CYBERDOOM — Retro 3D First-Person Shooter Studio**.
It is written so another maintainer or AI agent can recreate the project without the original
session. The three source files are the release; if they exist and match the deployed copy, use them
rather than rebuilding from prose.

- [ARCHITECTURE.md](ARCHITECTURE.md) — module map, formulas, schemas
- [TESTING.md](TESTING.md) — verified matrix and gaps
- [DEPLOYMENT.md](DEPLOYMENT.md) — Pages operations
- [AGENTS.md](../AGENTS.md) — one-page handoff

## 1. What is being reproduced

| Item | Value |
| --- | --- |
| Product | A complete, single-page, client-side retro FPS |
| Release | **v1.0.0**, build `2026.10.31` |
| Source | `index.html`, `style.css`, `script.js` — no build step, no package manager |
| Engine | Three.js **r128** via cdnjs + `PointerLockControls` via jsDelivr |
| Typefaces | Press Start 2P, Rajdhani, Share Tech Mono via Google Fonts |
| Sectors | 3 seeded procedural levels: Docking Bay Seven, Reactor Spine, The Cyber Core |
| Enemies | 3 archetypes: Cult Trooper, Cyber Hound, Siege Cyborg |
| Weapons | 2: Plasma Gun, Super Shotgun |
| Pickups | 4: medkit, armour shard, plasma cells, shotgun shells |
| Modes | Title, playing, paused, level clear, dying, game over, victory, fatal |
| Language | English only; all UI copy is literal in `index.html` or `script.js` |
| Persistence | `localStorage` autosave/settings/high scores + downloadable `cyberdoom_save.json` |
| Hosting | GitHub Pages, `main`, repository root, `.nojekyll` |
| Network | Required at runtime for Three.js, PointerLockControls and fonts; **not offline** |

What it is **not**: not a software raycaster, not multiplayer, not a server-backed game, not a
mobile-native app, not a gamepad title, not a framework starter, and not installable as an offline
PWA.

Live copy: <https://somphol.github.io/cyberdoom-retro-fps/>
Self-test: <https://somphol.github.io/cyberdoom-retro-fps/?selftest=1>
Local master: `~/Projects/cyberdoom-retro-fps`

## 2. Requirements matrix

The original brief asked for a production-ready, 100% client-side FPS in vanilla HTML/CSS/ES6 with
Three.js r128 and PointerLockControls, delivered as exactly three code blocks.

| Requirement | Implementation | Where |
| --- | --- | --- |
| 3D grid dungeon with textured walls, floor, ceiling | `DungeonLevel` + `TextureFactory.wall/floor/ceiling` | `script.js` |
| Modular labyrinth generation | `carveMaze`, `carveRooms`, `braidMaze`, `sealBorder`, `chooseStartAndExit` | `script.js` |
| FPS camera with pointer lock | `THREE.PointerLockControls`, `Game.init`, `getLookAngles` | `script.js` |
| WASD/arrow movement, jump, interact | `Game.onKeyDown`, `updatePlayer`, `tryInteract` | `script.js` |
| Billboard enemies and pickups | `THREE.Sprite` with `center.set(0.5, 0)`, `Enemy`, `Pickup` | `script.js` |
| Low-poly retro look with pixelation | internal render scale, `image-rendering: pixelated`, CRT overlays | `script.js`, `style.css` |
| Muzzle flash dynamic light | `muzzleLight`, intensity reset in `fire`/`updateWeapons` | `script.js` |
| Weapon HUD with sway/recoil | `HUD.drawWeapon`, `weaponRecoil`, `weaponRaise`, `bobPhase` | `script.js` |
| Hitscan ray verification | `Game.fire`, `shotRay`, `rayWallDistance`, `THREE.Ray.intersectBox` | `script.js` |
| Particle hit sparks | `ParticleField.spawnBurst` | `script.js` |
| Enemy patrol/idle + LOS aggro | `Enemy.update` (`idle`/`patrol`/`alert`/`chase`) | `script.js` |
| Enemy pursuit and projectiles | `findPath`, `followPath`, `Projectile`, `damagePlayer` | `script.js` |
| Three enemy archetypes | `ENEMY_TYPES`, `drawTrooper/drawHound/drawHeavy` | `script.js` |
| Web Audio synthesised SFX | `SynthEngine`, singleton `audio` | `script.js` |
| Doom-style status bar | status bar markup + `HUD.update` | `index.html`, `script.js`, `style.css` |
| Animated marine face by health | `HUD.drawFace` with four moods and reaction timers | `script.js` |
| Health, armour, ammo, score | `player`, `weapons`, `score`, `HUD` | `script.js` |
| localStorage autosave | `cyberdoom.autosave.v1`, `autosave`, `sanitiseRun` | `script.js` |
| Download `cyberdoom_save.json` | `buildExportPayload`, `exportSave` | `script.js` |
| Import save + high scores | `importFile`, `sanitiseRun`, `saveHighScores` | `script.js` |
| Retro sci-fi industrial theme | CSS variables `--acid`, `--crimson`, `--cyan`, panels, clip paths | `style.css` |
| Responsive mobile + touch controls | media queries, joystick/look pad/fire/jump/swap | `style.css`, `index.html`, `script.js` |
| Zero backend | static files only; CDN libraries and fonts | repo |
| Build/verification state | `STATE.md`, `state.json` | repo |

Late requirements captured from the build session:

- GitHub repository plus GitHub Pages deployment.
- Avoid repeated macOS Keychain prompts during push.
- Add state/timing/token data and credit OpenCode and the model.
- Keep the deliverable to three source files.
- Verify mobile at 390×844 as well as desktop at 1600×1000.
- Reach 17/17 self-tests with zero uncaught exceptions and zero console errors.

## 3. Non-negotiable constraints

| Constraint | Why | How it is enforced |
| --- | --- | --- |
| Exactly three app source files | Original output contract | `index.html` loads one stylesheet and one local script |
| No build step or package manager | Static Pages, instant edits | no `package.json`, no bundler |
| Three.js and PointerLockControls pinned to r128 | The code uses r128 APIs (`sRGBEncoding`, `PointerLockControls` global) | exact CDN URLs in `index.html` |
| All art and audio procedural | No binary asset pipeline | `TextureFactory`, `SynthEngine`; no images/audio in repo |
| Grid coordinates are `grid[z][x]` | Generator, collision, minimap and saves all assume it | `DungeonLevel.cellAt/isWall/world` |
| World cell size 2.8, wall height 3.7 | Collision, eye height, props, portal and camera tuned together | constants at top of `script.js` |
| Hitscan is wall-limited | A shot must not pass through walls | `rayWallDistance` first, enemy boxes compared to its distance |
| Save import is a whitelist | Imports are untrusted files | `sanitiseRun` returns `null` or a fully clamped run |
| Autosave clears on run end | Continue must not resume a finished run | `safeRemove` in `completeLevel`, `showVictory`, `showGameOver` |
| Enemy/pickup persistence is partial | Saves are small and human-readable | only type/x/z/health/state/dead/taken |
| `state.json` is historical | Honest build provenance | never read by `script.js` |

## 4. Reference environment

| Tool | Version / note |
| --- | --- |
| macOS | Darwin, Apple Silicon |
| Node.js | 26.x for `node --check` and `scripts/check.mjs`; no npm install |
| Python | 3.x, only for `python3 -m http.server` |
| Chrome | headless `--headless=new` with SwiftShader for build verification |
| Dependencies | none installed; Three.js/fonts come from CDNs at runtime |
| Git | `main`, public GitHub repository |

```bash
cd ~/Projects/cyberdoom-retro-fps
python3 -m http.server 8000
# open http://localhost:8000

node --check script.js
node scripts/check.mjs
node ~/.config/opencode/skills/skill-publish/scripts/check-skill.mjs skills/cyberdoom-retro-fps
```

`file://` can render the shell but is not the supported path: the CDN still needs network, and some
browsers restrict pointer lock and storage on local files. Serve over HTTP.

## 5. Repository map

| Path | Role |
| --- | --- |
| `index.html` | Shell, HUD, six overlay screens, touch controls, CDN tags |
| `style.css` | Design tokens, layout, HUD, CRT overlays, responsive/touch rules |
| `script.js` | Everything else: constants, audio, textures, level, entities, HUD, game, boot |
| `scripts/check.mjs` | Dependency-free release checks |
| `docs/` | This book and the supporting guides |
| `skills/cyberdoom-retro-fps/` | Reusable build skill + byte-identical template |
| `screenshot*.png` | Release screenshots (binary, not used at runtime) |
| `state.json` / `STATE.md` | Historical build report |
| `.nojekyll` | Disable Jekyll processing on Pages |

Source sizes at release: `index.html` ~21.7 KB / 366 lines, `style.css` ~46.9 KB / 1,541 lines,
`script.js` ~206.4 KB / 5,575 lines.

## 6. Build from scratch

If the sources exist, skip to §8. If they are lost, rebuild in this order. Each stage has an
acceptance check; do not continue until it passes.

### Stage 0 — Repository skeleton

```bash
mkdir -p ~/Projects/cyberdoom-retro-fps/{docs,scripts}
cd ~/Projects/cyberdoom-retro-fps
git init -b main
touch .nojekyll
printf 'node_modules/\n.env\n_site/\n' > .gitignore
```

Create `index.html`, `style.css`, `script.js`, `README.md`, `LICENSE` (MIT) and the docs folder. No
`package.json`.

**Accept:** `python3 -m http.server 8000` serves the directory; `GET /index.html` is 200.

### Stage 1 — HTML shell

Build `index.html` in this order:

1. Head: charset, viewport (`maximum-scale=1`, `viewport-fit=cover`), theme colour, description,
   title, favicon, Google Fonts, `style.css`, canonical and social metadata.
2. `<canvas id="game-canvas">` and five FX layers (`fx-scanlines`, `fx-vignette`, `fx-noise`,
   `fx-damage`, `fx-flash`).
3. HUD: sector card, compass, minimap, crosshair/hitmarker, interaction prompt, message feed, weapon
   canvas (900×420), status bar (ammo, vitals, face 96×96, armour, score), key hints.
4. Screens: `screen-start`, `screen-pause`, `screen-levelclear`, `screen-victory`,
   `screen-gameover`, `screen-loading`; plus `fatal-error`, `toast`, `touch-ui`, hidden file input.
5. Three scripts in order: Three.js r128, PointerLockControls, `script.js`.

Use `<button type="button">` throughout and stable ids. `script.js` queries specific ids; changing
them silently breaks the HUD.

**Accept:** all ids referenced by `HUD.elements` and `Game.bindEvents` exist exactly once.

### Stage 2 — CSS frame

Define the token block first: dark slate/black base, acid green `#8dff5a`, cyan `#4ff5df`, crimson
`#ff3b50`, amber `#ffb52e`, violet `#b478ff`, `--hud-h: 112px`, font stacks and clip-path corners.
Then implement: fixed full-screen app, canvas with `image-rendering: pixelated`, CRT overlays with
`pointer-events: none`, HUD grid, status bar, weapon stage, screens/modals, touch UI, breakpoints at
1120/900/680/420 px and a `prefers-reduced-motion` block.

**Accept:** at 1600×1000 and 390×844 the document has no horizontal overflow and the HUD does not
cover the title or pause buttons.

### Stage 3 — Constants and helpers

In `script.js` declare `VERSION = '1.0.0'`, `BUILD = '2026.10.31'`, `SAVE_FORMAT`, `SAVE_SCHEMA`,
the three storage keys, `CELL = 2.8`, `WALL_H = 3.7`, `EYE_HEIGHT = 1.62`,
`PLAYER_RADIUS = 0.42`, `GRAVITY = 19.5`, `JUMP_SPEED = 6.4`, `WALK_SPEED = 5.4`,
`SPRINT_SPEED = 7.4`, `MAX_DT = 0.05`, then `clamp`, `lerp`, `damp`, `rand`, `mulberry32`,
`safeGet/safeSet/safeRemove`, `readJson`, `sanitiseNumber`, `sanitiseString`, `escapeHtml`.

**Accept:** `node --check script.js` passes.

### Stage 4 — Audio

Implement `SynthEngine`: lazy `AudioContext`, master gain into a `DynamicsCompressor`, an ambient
bus, a 2-second noise buffer, `tone()` and `noise()` envelope helpers, and every named effect used by
the game (plasma, shotgun, dry fire, switch, growl, alert, enemy shot, hit, step, jump, pickup, hurt,
death, portal, level clear, victory). Create one singleton `audio`.

**Accept:** after a click, `audio.ensure()` returns true and firing produces sound; before a gesture,
no AudioContext is created.

### Stage 5 — Game data

Add `WEAPONS` (plasma 27 damage, 0.155 s cooldown, 44 range; shotgun 12 × 9 pellets, 0.82 s, 24
range), `ENEMY_TYPES` (trooper/hound/heavy with the values in [ARCHITECTURE](ARCHITECTURE.md)),
`LEVELS` (three entries with size, rooms, braid, rosters, theme) and `PICKUP_TYPES` (25/25/35/9).

**Accept:** the three tables match the documented numbers exactly; changing one without the other
breaks balance and self-tests.

### Stage 6 — Procedural art

Implement `makeCanvas`, `toTexture`, `px`, `shade`, `withAlpha`, `speckle`, then `TextureFactory`:
`wall` (128², three variants), `floor` (256², 4×4 panels + grates + hazard strip), `ceiling` (128²),
`crate` (64²), `glow`, `spark`, `enemyAtlas` (3 × 64×96 frames), `pickup`, `sign`, `portalLabel`, and
the enemy draw routines. Use `NearestFilter`, sRGB encoding, and `RepeatWrapping` unless a clamp is
needed.

**Accept:** a texture dump shows three distinct wall variants and a 192×96 enemy atlas per type; no
image request appears in DevTools.

### Stage 7 — Level generator and meshes

Implement `DungeonLevel` exactly as in [ARCHITECTURE §4](ARCHITECTURE.md): 2D `grid[z][x]`, recursive
backtracker, rooms, braid, sealed border, start/exit selection, BFS distances, `openCells`, world
transform, collision, LOS, A*, props, lights, signs, portal and `dispose`.

**Accept:** for seed `0xC0FFEE`, `openCells.length > 80`, exit BFS distance > 10, start is collision
free, a solid cell collides, and `findPath(start, exit)` is non-empty. These are the first four
dungeon self-tests.

### Stage 8 — Entities

Implement `Enemy`, `Projectile`, `Pickup`. Enemy: sprite atlas clone, health bar sprites, AABB,
idle/patrol/alert/chase/dead flow, alert propagation, separation, path following, ranged/melee
attacks, death fade, `serialize`. Projectile: two substeps, wall/prop/player collision, life 4.5 s.
Pickup: bob, glow, ring, 1.0-unit collection radius, `serialize`.

**Accept:** enemies aggro only with LOS, walk around walls, damage the player, die and score; pickups
disappear and change the matching stat.

### Stage 9 — HUD

Implement `HUD` with every element from `index.html`: values, bars, face, weapon canvas, minimap,
compass, prompts, message feed, clock. Throttle the minimap to 0.09 s; draw face and weapon every
frame. Max four messages, default 3.4 s.

**Accept:** the HUD reacts to health, armour, ammo, weapon switch, kills and hostiles remaining; the
face changes at 75/50/25 HP.

### Stage 10 — Game orchestration

Implement `Game` in this order: constructor/state, `init`, `fatal`, `bindEvents`, `applySettings`,
`resize`, input handlers, touch setup, screens and boot, asset caches, run lifecycle
(`resetRun/startNew/continueRun/applyRun/beginLevel/setupAmbient/generateEnemies/generatePickups/
disposeWorld`), combat (`switchWeapon/getLookDirection/getLookAngles/applyLookAngles/fire/shotRay/
rayWallDistance/alertEnemiesNearby/damagePlayer/die/onEnemyKilled/collectPickup/checkExit/
completeLevel/nextLevel/showVictory/showGameOver/retrySector`), pause/title, simulation updates,
autosave, export/import, self-test, `update`, `animate`.

**Accept:** a full loop works: new campaign → kill all → portal unlocks → Space/enter → next sector →
victory; death → retry; pause → save → title → continue.

### Stage 11 — Persistence

Implement `gatherRun`, `autosave`, `buildExportPayload`, `exportSave`, `importFile`, `sanitiseRun`,
`loadHighScores`, `saveHighScores`, `recordHighScore`, settings load/save. Use the exact keys and
shapes in [ARCHITECTURE §10](ARCHITECTURE.md). Autosave every 3.8 s, on pause and on `beforeunload`.

**Accept:** reload restores sector, seed, position, health, armour, ammo, score, enemies and pickups;
a downloaded save re-imports on a fresh profile; malformed input is rejected without a partial run.

### Stage 12 — Self-test and release

Implement `Game.selfTest()` with the 17 checks listed in [TESTING](TESTING.md), the
`?selftest=1` / `?play=1` parameters, `window.CyberDoom`, and the `window.__cyberdoomGame` handle.
Add `.nojekyll`, README, licence, screenshots, `state.json`/`STATE.md`, docs and `scripts/check.mjs`.
Enable Pages on `main` / root.

**Accept:** `?selftest=1` reports 17/17; `node scripts/check.mjs` passes; the live URL returns 200.

## 7. Where the non-obvious numbers came from

| Number | Why it is that value |
| --- | --- |
| `CELL = 2.8`, `WALL_H = 3.7` | Gives ~2.2 m of headroom above the 1.62 m eye line, with walls thick enough that a 0.42 m player cannot clip corners at walk speed. Maze corridors are one cell wide, so 2.8 m reads as a corridor rather than a hall. |
| `EYE_HEIGHT = 1.62` | Human eye height; the floodlight and muzzle light are parented to this camera, so changing it moves both. |
| `PLAYER_RADIUS = 0.42` | Leaves 0.58 m per side in a 2.8 m corridor after the collision margin; larger values make corners sticky, smaller values let the camera enter wall geometry. |
| `WALK_SPEED 5.4`, `SPRINT 7.4` | Doom-like pace: ~1.9× a real walk, fast enough to dodge projectiles but slow enough for the 23–27 cell maps. |
| `GRAVITY 19.5`, `JUMP_SPEED 6.4` | Apex ≈ `6.4²/(2*19.5) = 1.05` m, airtime ≈ 0.66 s. Enough to feel arcade without clearing props. |
| `damp(..., 11, dt)` | ~90% of target velocity in 0.21 s; gives weight without input lag. |
| `MAX_DT = 0.05` | Caps a frame at 50 ms so tab-switch spikes do not launch the player through walls or let enemies teleport. |
| Hitscan step `0.1` | At most 10 cm of wall error at 44 m range, cheap enough for 9 pellets per shot. |
| Hitbox scale `0.72 × width` / `0.62 × width` | Shrinks the visible billboard just enough that near-misses read as misses; full sprite width felt unfair. |
| Plasma 27 / shotgun 12×9 | Trooper (64 HP) dies in 3 plasma hits or 6 pellets; hound (38) dies in 2 plasma or 4 pellets; heavy (156) takes 6 plasma or 13 pellets at close range. |
| Enemy cooldowns 1.55 / 0.95 / 2.15 | Sets a dodge rhythm: trooper shots are spaced, hound bites are fast but must close to 1.55 m, heavy volleys punish standing still. |
| Armour absorbs 58% | Armour is a buffer, not a second health bar; 100 armour absorbs ~58% of 172 incoming damage before emptying. |
| Autosave 3.8 s | "Every few seconds" from the brief without hammering synchronous localStorage. |
| Internal render scale default 0.75 | Pixelated but legible at 1600×1000; clamped to 1920×1200 buffer and floor 0.42. |
| FOV 72° vertical | Wide enough for a corridor shooter, narrow enough that billboards do not stretch at the edges. |
| Palette `#8dff5a` / `#ff3b50` / `#4ff5df` | Acid green UI, crimson threat/damage, cyan plasma and scanner; all three are reused in textures, HUD, sprites and level trim. |
| Level sizes 23/25/27 | Odd sizes keep the recursive backtracker on odd cells; each sector adds two cells of span and one room/enemy tier. |
| Braid 0.15/0.11/0.09 | Early sectors feel more open and forgiving; the core is more maze-like and hostile. |
| Rank thresholds 7500/6000/4500/3000 | Tuned against the maximum clear bonus chain (three sectors, all kills, high health); an S run requires most kills and most bonuses. |

## 8. Verification procedure

```bash
cd ~/Projects/cyberdoom-retro-fps
node --check script.js
node scripts/check.mjs
python3 -m http.server 8000
```

Then:

1. Open `http://localhost:8000/?selftest=1`; wait 2 s; expect `17/17` in the console and
   `<html data-selftest="17/17">`.
2. Open `http://localhost:8000/`; start a campaign; confirm HUD, pointer lock, movement, jump, fire,
   weapon switch, pause, save download and import.
3. Kill all hostiles; confirm the portal turns green and the prompt appears.
4. Enter the portal; confirm the clear screen, next sector, and final victory.
5. Die; confirm game over and retry.
6. Resize to 390×844 (device emulation, touch) and confirm no horizontal overflow and usable touch
   pads.
7. Reload after a few seconds; confirm Continue Run restores the sector, position, ammo and score.

Expected static result: `OK <n> checks` and exit 0. The exact count is reported by the script; do not
hard-code it in a release note without re-running.

Expected browser result: 17/17 self-tests, no uncaught exceptions, no console errors. See
[TESTING.md](TESTING.md) for what was actually observed and what remains manual.

## 9. What was tried, rejected or fixed

From the build session:

| Item | Outcome |
| --- | --- |
| Monolithic single write | Rejected during construction. The script was authored as seven `src/*.js` chunks (`01_core` … `06_game_b`) and concatenated with `cat` into `script.js`; the temporary `src/` directory was removed. The released artefact is still one file, not a bundle. |
| Lenient import validator | Initially `sanitiseRun({level: 99})` clamped 99 into range and passed, so the self-test "Save validator rejects malformed input" failed (16/17). Replaced with a strict integer/range check that returns `null`. |
| Pointer lock in headless Chrome | `requestPointerLock()` threw an unhandled `WrongDocumentError` because headless documents cannot lock. Added `isHeadless` detection, skipped lock requests there, and wrapped `controls.lock` so a rejected promise is caught. |
| Missing favicon | Early runs logged a 404. Added `favicon.svg` and linked it in `index.html`. |
| Mobile HUD overflow | At 390×844 the weapon stage measured ~452 px wide with a negative left edge. CSS was adjusted; final runs reported `innerWidth = scrollWidth = 390`. |
| Separate status bar on mobile | The face panel is intentionally hidden at narrow widths to keep ammo/vitals/armour/score readable. |
| Real-time shadows | Disabled (`castShadow`/`receiveShadow` off) because the point-light count and SwiftShader made them expensive and noisy. |
| Software raycaster | Not used. The brief's "raycast" requirement is satisfied by hitscan verification; the world is Three.js geometry. Do not rewrite it into a per-column raycaster to match the label. |
| Dedicated `attack` state | Not used. Attacks are a branch inside `chase`; adding an `attack` state would require a new transition and is not part of 1.0.0. |
| Direct `file://` support | Not a goal: CDN scripts and fonts still require network, and pointer lock/storage differ on local files. HTTP serving is documented. |

## 10. Honest deviations and unfinished parts

| Item | State |
| --- | --- |
| Offline operation | **Not offline.** Three.js, PointerLockControls and Google Fonts are remote. A blocked CDN produces the fatal screen; blocked fonts fall back to system stacks. |
| Raycaster label | The renderer is a 3D mesh renderer with billboards, not a per-column raycaster. The hitscan march is documented in [ARCHITECTURE §6](ARCHITECTURE.md). |
| CI | No GitHub Actions workflow is present. `scripts/check.mjs` is local; browser self-tests are manual/headless ad hoc. |
| Save fidelity | The level grid is regenerated from the seed, but prop offsets use `Math.random` and are not saved. Prop collision positions can differ slightly after a reload. Enemy patrol paths and alert timers are not saved. |
| Seed edge case | `sanitiseRun` clamps the seed to ≥ 1, so a run generated with seed 0 would reload as seed 1. The chance is 1 in 2³². |
| Audio | Requires a user gesture. Synth timbre depends on the browser's Web Audio implementation. |
| Browser coverage | Built and tested in Chrome (headless and desktop). Firefox/Safari were not formally automated. |
| Touch coverage | Verified at 390×844 portrait with touch emulation. Landscape and tablets were not separately verified. |
| Accessibility | The canvas has an `aria-label`; the HUD has section labels. There is no keyboard-only aiming, no screen-reader representation of the 3D world, and no focus trap in overlays. |
| Performance | ~194 draw calls, ~3,684 triangles, ~57 FPS at 1600×1000 in the build environment (SwiftShader). Real GPU results will differ. |
| `state.json` | Historical build record, not runtime state. Do not wire it into the game. |

## 11. Restore or recreate?

| Situation | Action |
| --- | --- |
| Sources exist and the live hash matches | Use them; read docs for context |
| Sources exist but hashes differ | Inspect the diff; decide whether it is a new release |
| Sources lost, docs intact | Rebuild with §6, then run §8 |
| Only README survives | Recover from GitHub or the release commit first |
| Live site broken | Revert the bad commit; see [DEPLOYMENT](DEPLOYMENT.md) |

## 12. Handoff checklist

- [ ] `node --check script.js` passes.
- [ ] `node scripts/check.mjs` prints `OK <n> checks`.
- [ ] `?selftest=1` reports 17/17.
- [ ] `python3 -m http.server 8000` serves a playable page.
- [ ] Live URL returns 200 and serves the same `script.js` hash as `main`.
- [ ] The skill template is byte-identical to `index.html`, `style.css`, `script.js`.
- [ ] Any new save field is added to `gatherRun`, `sanitiseRun` and `applyRun`.
- [ ] Any new HUD id exists in `index.html` before `HUD` is constructed.
- [ ] `state.json` remains historical.
