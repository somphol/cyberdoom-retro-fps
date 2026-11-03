---
name: CYBERDOOM Retro FPS
description: Build a complete static retro 3D first-person shooter with Three.js r128, seeded sectors, procedural art and audio, hitscan combat, billboard enemies, HUD and portable saves.
version: 1.0.0
---

# CYBERDOOM Retro FPS

Build a self-contained 1990s-style first-person shooter as three static files:
`index.html`, `style.css`, `script.js`. The reference implementation in
`assets/template/` is a complete, working three-sector game — use it as a
starting point, a mechanism reference, or a template to reskin. It is not a
framework and has no build step.

## When to use

- A user asks for a Doom/Wolfenstein-inspired browser FPS, a raycast-style
  corridor shooter, or a retro 3D combat demo on static hosting.
- The result must be vanilla HTML/CSS/ES6 with Three.js from a CDN, procedural
  Canvas 2D art, Web Audio synthesis, and no backend.
- You need a seeded level generator, billboard enemies, hitscan weapons,
  localStorage autosave, downloadable saves, and GitHub Pages release.
- You need a tested reference for pointer-lock movement, A* enemies, or a
  Doom-style status bar.

**Not for:** a true per-column software raycaster (this uses Three.js geometry
plus hitscan), multiplayer/netcode, server-authoritative games, mobile-native
apps, or anything that must run fully offline — Three.js, PointerLockControls
and Google Fonts are remote.

## What it produces

| Output | Detail |
| --- | --- |
| `index.html` | Canvas, FX layers, HUD, title/pause/clear/victory/game-over screens, touch UI |
| `style.css` | Retro-industrial tokens, HUD chrome, CRT overlays, responsive/touch rules |
| `script.js` | Constants, audio synth, procedural textures, dungeon generator, entities, HUD, game, saves, self-test |
| Runtime | Three.js r128 + PointerLockControls r128 + Google Fonts, all via CDN |
| Saves | `localStorage` + `cyberdoom_save.json` export/import |
| Release | GitHub Pages from `main` / root with `.nojekyll` |

The reference game has three sectors, two weapons, three enemy archetypes, four
pickup types, touch controls, a 17-check in-browser self-test, and no binary
assets.

## Quick start

```sh
mkdir -p ~/Projects/my-fps
cp ~/.config/opencode/skills/cyberdoom-retro-fps/assets/template/index.html \
   ~/.config/opencode/skills/cyberdoom-retro-fps/assets/template/style.css \
   ~/.config/opencode/skills/cyberdoom-retro-fps/assets/template/script.js \
   ~/Projects/my-fps/
cd ~/Projects/my-fps
touch .nojekyll
python3 -m http.server 8000
# open http://localhost:8000/
```

There is no install and no build. Serve over HTTP; `file://` is not supported
because the CDN still needs network and pointer lock/storage differ on local
files.

The template carries the original canonical/OG URLs, favicon link and credits.
For a derived project, update the absolute URLs in `index.html`, supply
`favicon.svg` (or remove the icon link), and change `VERSION`, `BUILD` and the
credits block in `script.js`.

## Workflow

1. **Decide the theme and roster.** Write the three sector names, palettes
   (wall/floor/ceiling/fog/ambient/light/trim/prop), enemy counts and pickup
   counts before touching code. The reference values are a balanced baseline.
2. **Copy the template** with the command above, or start from the existing
   project and keep its files.
3. **Change data first.** Most reskins are `LEVELS`, `ENEMY_TYPES`, `WEAPONS`,
   `PICKUP_TYPES`, the sign strings in `DungeonLevel.addSigns`, the HUD labels
   in `index.html`, and the CSS tokens. Do not fork the loop for a reskin.
4. **Run and inspect.** `?selftest=1` reports 17/17 only when the browser can
   load Three.js, create WebGL and mount the HUD. Fix boot errors first.
5. **Tune movement and combat** with the numbers in `references/method.md`.
   Re-test corners, spawn safety, portal access and mobile layout after any
   change to `CELL`, `WALL_H`, `PLAYER_RADIUS` or enemy radii.
6. **Verify** with the static checks and the browser matrix in
   `references/verification.md`.
7. **Release** on GitHub Pages: `main` / root, `.nojekyll`, then verify the live
   `script.js` hash matches local.

## Module map

`script.js` is a single IIFE; order matters.

| Block | Identifiers | Responsibility |
| --- | --- | --- |
| Constants | `CELL`, `WALL_H`, `EYE_HEIGHT`, `PLAYER_RADIUS`, `GRAVITY`, `JUMP_SPEED`, `WALK_SPEED`, `SPRINT_SPEED`, `MAX_DT` | World scale and movement |
| Storage | `STORAGE_KEYS`, `safeGet/Set/Remove`, `readJson`, `sanitiseNumber/String` | Never throw on blocked storage |
| Audio | `SynthEngine`, `audio` | One lazy AudioContext, noise buffer, tones, every SFX |
| Data | `WEAPONS`, `ENEMY_TYPES`, `LEVELS`, `PICKUP_TYPES` | Balance and rosters |
| Art | `TextureFactory`, `ParticleField`, `TracerPool` | All visuals and effects |
| World | `DungeonLevel` | `grid[z][x]`, maze/rooms/braid, BFS, collision, LOS, A*, meshes, portal |
| Entities | `Enemy`, `Projectile`, `Pickup` | Sprites, state machine, attacks, serialization |
| HUD | `HUD` | Status bar, face, weapon canvas, minimap, messages |
| Saves | `sanitiseRun`, `loadHighScores`, `recordHighScore` | Strict import, clamps, top 8 |
| Game | `Game` | Input, physics, combat, flow, autosave, self-test, loop |

## Core recipes

### 1. Reskin or add a sector

Edit one `LEVELS` entry; keep `size` odd (23/25/27) so the recursive backtracker
lands on odd cells, and keep `rooms` and `braid` plausible. Enemies spawn only
on reachable cells with BFS distance ≥ 4, so a new theme cannot break
reachability, but a very high `braid` can flatten the maze and a very low one can
make long dead ends.

```js
{
  id: 3, name: 'MY SECTOR', code: 'SECTOR 04',
  size: 25, rooms: 4, braid: 0.12,
  enemies: { trooper: 5, hound: 3, heavy: 1 },
  pickups: { health: 2, armor: 2, plasma: 3, shells: 2 },
  theme: { wall: '#243932', wallDark: '#14221d', wallLight: '#3d5a4c',
           trim: '#7dff5a', floor: '#1d2723', floorLine: '#365045',
           ceiling: '#101816', fog: 0x07100d, ambient: 0x315a47,
           light: 0x79ffc2, prop: '#2d443a' }
}
```

Then update `addSigns()` text, the level clamp in `sanitiseRun` (it uses
`LEVELS.length`), and the rank/score expectations. Do not add a fourth level
without updating `sanitiseRun` and any test that assumes three.

### 2. Add a weapon

1. Add an entry to `WEAPONS` with `id`, `name`, `ammoName`, `ammoKey`, max ammo,
   damage, cooldown, pellets, spread, range, colours and score.
2. Add its ammo state to `Game.weapons`, `resetRun`, `gatherRun`, `sanitiseRun`
   and `applyRun`.
3. In `Game.fire()`, use the existing pellet loop; only branch for a different
   damage model (e.g. falloff or explosive). Do not bypass `shotRay` — it is the
   wall-occlusion contract.
4. Add a HUD viewmodel branch in `HUD.drawWeapon` and a key/wheel entry in
   `switchWeapon` (`Digit1`, `Digit2`, `KeyQ`, wheel).
5. Check the ammo pickup path in `collectPickup` and the clear/next-level ammo
   grants in `nextLevel`/`retrySector`.

Hitscan contract: `rayWallDistance` is computed first; an enemy is accepted only
if `ray.intersectBox` distance ≤ wall distance. Shotgun falloff is
`clamp(1 - distance/range * 0.45, 0.52, 1)`; headshots double damage when the hit
point is above 80% of the enemy height.

### 3. Add or replace an enemy archetype

1. Add a `ENEMY_TYPES` entry with hp, speed, radius, height, width, sight,
   attackRange, preferredRange, damage, cooldown, projectileSpeed,
   projectileColor, score and bob.
2. Draw a 3-frame 64×96 atlas in `TextureFactory.enemyAtlas` and a matching
   `draw*` routine. Frame 0 is idle/walk, frame 1 is the second walk frame,
   frame 2 is attack.
3. `Enemy.update` branches on `typeId` for melee (`hound`) versus ranged. A new
   melee type must be added to the hound checks; a new ranged type uses
   `fireAtPlayer` and its `projectileSpeed`.
4. Add it to sector rosters and to the save whitelist if it is not already in
   `ENEMY_TYPES` (the whitelist is automatic).
5. Test LOS aggro, path following, separation, damage, death fade and score.

## Failure boundaries

- **Do not add a build step, package manager or framework.** The product is
  three static files. No bundler, no transpiler, no service worker.
- **Do not change the Three.js version casually.** The code uses r128 globals
  and `sRGBEncoding`; a version jump is a migration.
- **Do not make the game offline.** It needs the Three.js CDN, PointerLockControls
  CDN and Google Fonts. Say so in docs; do not claim offline support.
- **Keep `grid[z][x]`.** Collision, A*, minimap, spawns and saves assume it.
- **Do not unclip hitscan.** The wall march is the only thing stopping shots
  through walls; a raw `Raycaster` will shoot through geometry.
- **Do not trust imported JSON.** `sanitiseRun` must reject bad level/seed shape
  and clamp every number. Never apply a partial run.
- **Clone enemy textures per instance.** `texture.offset.x` is per-enemy; sharing
  one texture makes every enemy animate together.
- **Pointer lock needs a gesture and a top-level document.** Request it from a
  click; catch the rejected promise; skip it in headless/webdriver contexts.
- **Audio needs a gesture.** Call `audio.ensure()` after the first click/key;
  never create an AudioContext at boot.
- **`state.json` is not runtime state.** Keep it historical.
- **Do not leave the original identity in a reskin.** The template’s canonical,
  Open Graph, Twitter and sitemap URLs point at the reference deployment. Update
  them, the favicon, `VERSION`, `BUILD` and the credits block before publishing.
- **Do not claim browser coverage you did not run.** Chrome-only is honest;
  Firefox/Safari and real touch hardware need explicit testing.

## Verification

```sh
node --check script.js
node scripts/check.mjs          # if the project carries the check script
python3 -m http.server 8000
```

Browser: open `?selftest=1`, expect `17/17` and `data-selftest="17/17"`; then run
the manual matrix in `references/verification.md` (movement, both weapons, AI,
damage, portal, all three sectors, victory, death/retry, save export/import,
390×844 layout). Static checks cannot prove rendering, pointer lock, audio
output or touch input.

For a derived project, also confirm:

- No binary art/audio was added; every texture is drawn in `TextureFactory`.
- No external asset requests beyond the three CDN origins.
- The save schema version and `VERSION` agree.
- The skill/template (if kept) is byte-identical to the release sources.

See `references/method.md` for build order and constants, `references/lessons.md`
for bugs that regress, and `references/verification.md` for exact checks.
