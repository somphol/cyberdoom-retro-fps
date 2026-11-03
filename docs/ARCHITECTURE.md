# Architecture

CYBERDOOM is three static files plus a CDN. `index.html` supplies the DOM, `style.css` supplies the
frame, and `script.js` is one IIFE that builds the renderer, the level, the entities, the HUD, the
audio graph and the game loop. There is no bundler, module loader, framework or build output.

- [AGENTS.md](../AGENTS.md) — handoff summary
- [REPRODUCTION.md](REPRODUCTION.md) — rebuild book
- [TESTING.md](TESTING.md) — what was and was not verified
- [DEPLOYMENT.md](DEPLOYMENT.md) — Pages operations

## 1. Load order and boot

`index.html` loads, in order:

1. Google Fonts stylesheet (`Press Start 2P`, `Rajdhani`, `Share Tech Mono`).
2. `style.css`.
3. `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`.
4. `https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/PointerLockControls.js`.
5. `script.js`.

`script.js` evaluates as one strict-mode IIFE. Declaration order matters because classes reference
constants and helpers defined above them:

| Order | Block | Key identifiers |
| --- | --- | --- |
| 1 | Constants and helpers | `VERSION`, `CELL`, `WALL_H`, `EYE_HEIGHT`, `PLAYER_RADIUS`, `GRAVITY`, `JUMP_SPEED`, `WALK_SPEED`, `SPRINT_SPEED`, `MAX_DT`, `mulberry32`, `safeGet`, `safeSet`, `readJson`, `sanitiseNumber`, `sanitiseString` |
| 2 | Settings | `DEFAULT_SETTINGS`, `loadSettings`, `saveSettings`, `settings` |
| 3 | Audio | `SynthEngine`, singleton `audio` |
| 4 | Game data | `WEAPONS`, `ENEMY_TYPES`, `LEVELS`, `PICKUP_TYPES` |
| 5 | Procedural art | `TextureFactory`, `ParticleField`, `TracerPool` |
| 6 | World | `DungeonLevel` |
| 7 | Entities | `Enemy`, `Projectile`, `Pickup` |
| 8 | HUD and saves | `HUD`, `loadHighScores`, `sanitiseRun`, `FallbackPointerControls` |
| 9 | Game | `Game` |
| 10 | Boot | `new Game()`, `window.__cyberdoomGame`, `window.CyberDoom`, URL-parameter handling |

Boot sequence inside `new Game()` → `init()`:

1. Fail loudly if `THREE` is absent (`fatal()` shows `#fatal-error`).
2. Create `THREE.WebGLRenderer` on `#game-canvas`; `setPixelRatio(1)`, sRGB output, clear colour
   `0x020403`.
3. Create `THREE.Scene`, `PerspectiveCamera(72, 1, 0.05, 70)` with rotation order `YXZ`, and a
   `worldGroup`.
4. Create `THREE.PointerLockControls` (or `FallbackPointerControls`) and replace `controls.lock`
   with a wrapper that catches a rejected `requestPointerLock()` promise.
5. Add the suit floodlight (`SpotLight`) and muzzle light (`PointLight`) as camera children.
6. Construct `ParticleField`, `TracerPool`, `HUD`.
7. `bindEvents()`, `applySettings(true)`, `resize()`.
8. `updateTitleRecords()`, `updateContinueButton()`, `showTitle()`, `boot()` (fake loading bar), then
   `requestAnimationFrame(this.animate)`.

`?selftest=1` runs `game.selfTest()` after 1.5 s and writes `data-selftest="pass/total"` on
`<html>`. `?play=1` or `?autostart=1` calls `startNew()` after 1.7 s if the game is still on the
title screen. `window.CyberDoom` exposes state, teleport, spawn, kill, save and self-test helpers for
browser automation.

## 2. Module map

| File / symbol | Responsibility | Notes |
| --- | --- | --- |
| `index.html` | Shell, six overlay screens, HUD status bar, touch controls, CDN tags | All gameplay is on one `<canvas id="game-canvas">` |
| `style.css` | Design tokens, HUD chrome, screens, CRT overlays, responsive layout | Breakpoints 1120, 900, 680, 420 px; reduced-motion block at the end |
| `SynthEngine` | Web Audio graph, noise buffer, oscillator envelopes, all sound effects | One `AudioContext`, created lazily by `ensure()` |
| `TextureFactory` | Canvas 2D wall/floor/ceiling/crate/sign/enemy/pickup/glow/portal art | Every texture is generated at runtime |
| `ParticleField` | Fixed 280-particle `THREE.Points` pool | Additive sparks, gravity and drag |
| `TracerPool` | Pooled additive tracer strips for hitscan | 20-line ring buffer |
| `DungeonLevel` | Seeded maze, rooms, braiding, BFS distances, collision, LOS, A*, meshes, props, lights, portal | `grid[z][x]` |
| `Enemy` | Billboard sprite, health bar, state machine, path following, attacks | Three archetypes |
| `Projectile` | Enemy plasma bolts, wall/obstacle/player collision | Two substeps per frame |
| `Pickup` | Floating billboard supply item and pickup radius | Four types |
| `HUD` | Status bar values, marine face, weapon viewmodel, minimap, compass, messages, prompts | `update(dt, game)` |
| `sanitiseRun` | Strict import validator and clamp layer | Rejects invalid level/seed shape |
| `Game` | Renderer, input, physics, combat, level flow, persistence, self-test, loop | Central orchestrator |
| `FallbackPointerControls` | Minimal pointer-lock look fallback | Only used when `THREE.PointerLockControls` is missing |

## 3. Data flow

```text
keyboard / mouse / touch
        │
        ▼
Game.keys, touchMove, lookPitch/lookYaw, fire()
        │
        ├── updatePlayer(dt) ──► DungeonLevel.moveEntity / collides
        ├── fire() ──► shotRay() ──► rayWallDistance() + THREE.Ray.intersectBox
        │                     └── Enemy.takeDamage / die / onEnemyKilled
        ├── Enemy.update(dt) ──► hasLineOfSight / findPath / Projectile
        ├── Projectile.update(dt) ──► damagePlayer
        ├── Pickup.update(dt) ──► collectPickup
        ├── DungeonLevel.update() ──► portal rings and lights
        └── HUD.update(dt, game) ──► DOM + face/weapon/minimap canvases
        │
        ▼
renderer.render(scene, camera)
```

The simulation runs at display rate. `MAX_DT = 0.05` clamps a frame to 50 ms, so a slow tab slows the
game rather than teleporting entities. `Game.animate` catches render exceptions, logs the first one
as `CYBERDOOM render fault`, and keeps the loop alive.

## 4. Map format and generation

`DungeonLevel.grid` is a square array of integers, indexed `grid[z][x]`:

```text
0 = open floor
1 = solid wall
```

`size` is 23, 25 or 27. `CELL = 2.8` world units. `half = (size * CELL) / 2`. A cell maps to world
space by its centre:

```text
worldX = (gx + 0.5) * CELL - half
worldZ = (gz + 0.5) * CELL - half
gx     = floor((x + half) / CELL)
gz     = floor((z + half) / CELL)
```

Generation order in `DungeonLevel.generate()`:

1. `carveMaze(1, 1)` — recursive backtracker on odd coordinates. It carves the start, then steps two
   cells at a time in one of four directions, opening the wall between.
2. `carveRooms()` — attempts `rooms * 18` odd-aligned rectangles of width/height 3, 5 or 7 with a
   one-cell buffer between rooms, up to the configured room count.
3. `braidMaze()` — with the level's `braid` probability, opens a wall that has open cells on exactly
   two opposite sides (removes dead ends and creates loops).
4. `sealBorder()` — forces the outer ring to wall.
5. `chooseStartAndExit()` — the start is the centre of the room with the smallest `cx + cz` (or the
   first open cell). BFS distance from the start chooses the reachable room with the greatest
   distance as the exit; fallback is the farthest open cell. The 3×3 around the exit is opened.
6. `computeDistances()` — four-neighbour BFS, `-1` for unreachable.
7. `collectOpenCells()` — reachable walkable cells with world coordinates and distance.

The seed is a 32-bit integer passed through `mulberry32`. Maze, rooms, braiding, start, exit, wall
variants, lights, signs and props are deterministic for a given seed. **Prop offsets are not:** the
crate/barrel/pillar positions add `rand(-0.35, 0.35)` from `Math.random`, and their collision circles
follow those offsets. Saves store the seed and entity coordinates, not the grid or prop offsets.

Level configuration (`LEVELS`):

| # | Name | Size | Rooms | Braid | Enemies | Pickups |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Docking Bay Seven | 23 | 3 | 0.15 | 5 trooper, 2 hound | 2 health, 1 armor, 2 plasma, 2 shells |
| 1 | Reactor Spine | 25 | 4 | 0.11 | 5 trooper, 4 hound, 1 heavy | 2 health, 2 armor, 3 plasma, 2 shells |
| 2 | The Cyber Core | 27 | 4 | 0.09 | 6 trooper, 5 hound, 2 heavy | 3 health, 2 armor, 3 plasma, 3 shells |

Spawn rules: enemies normally require a reachable cell at distance ≥ 4 from the start, not the start
cell, not blocked at radius 0.55, and Manhattan spacing ≥ 2. A failsafe pass may reuse a nearer
reachable cell if the roster cannot be placed. Pickups require distance ≥ 2, not blocked at radius
0.5, and not on an enemy, the start or the exit.

## 5. Physics, collision and navigation

`DungeonLevel.collides(x, z, radius)` is a circle-vs-cell test. For every cell overlapping the
circle's AABB it clamps the point to the cell rectangle and tests:

```text
dx = x - clamp(x, cx - CELL/2, cx + CELL/2)
dz = z - clamp(z, cz - CELL/2, cz + CELL/2)
collision if dx*dx + dz*dz < radius*radius
```

It also treats the level border as solid and tests circular prop obstacles. `moveEntity` tries the
full move first, then each axis separately, which produces wall sliding. The player uses
`PLAYER_RADIUS = 0.42`; enemies use their archetype radius.

`hasLineOfSight` samples the segment every 0.22 world units and returns false on the first wall cell.
It is a visibility check, not a ray-cast against wall geometry.

`findPath` is A* on the four-neighbour grid with Manhattan heuristic. It returns world-space cell
centres, caps expansion at 2,500 nodes, and returns `[]` if either endpoint is solid. Enemies re-plan
on timers (0.55–0.9 s while chasing, 1.1 s toward a last-seen point, 1.6–3.1 s on patrol) rather than
every frame.

Player movement:

```text
look   = camera forward, Y zeroed, normalized
right  = (-look.z, 0, look.x)
desired = (look * forwardInput + right * strafeInput) * speed
velocity = damp(velocity, desired, 11, dt)
jump: verticalVelocity = 6.4; gravity = 19.5 per second²
cameraY = player.y + 1.62 + bob
bob = sin(bobPhase) * 0.04 * clamp(horizontalSpeed / 5.4, 0, 1.25)
```

`damp(a, b, lambda, dt) = lerp(a, b, 1 - exp(-lambda * dt))`. Walk speed is 5.4, sprint 7.4. Footstep
intervals are 0.32 s sprinting and 0.43 s walking. Enemies and the player push apart after movement.

## 6. Ray maths: hitscan, occlusion and projectiles

There is **no per-column software raycaster**. The first-person view is real Three.js geometry viewed
by a perspective camera; enemies, pickups, signs and the portal label are billboarded sprites. The
"raycast" in the design brief is the hitscan used by weapons and the point sampling used for wall
occlusion.

Camera and projection:

```text
PerspectiveCamera(verticalFov = 72°, aspect = innerWidth / innerHeight, near = 0.05, far = 70)
rotation order = YXZ; pitch clamped to ±1.35 rad
eye height = 1.62 + jump height + head bob
FOV kick target = 72 + fovKick * 2.4
```

`Game.fire()` builds the shot basis from the camera:

```text
forward = camera.getWorldDirection()
right   = normalize(-forward.z, 0, forward.x)
up      = normalize(cross(right, forward))
muzzle  = origin + forward*0.7 + right*0.18 + up*(-0.14)
```

Each pellet adds `rand(-spread, spread)` along `right` and `up`, renormalizes, then calls
`shotRay(origin, direction, range)`.

`rayWallDistance(origin, direction, range)`:

```text
floorT = (-origin.y) / direction.y            if direction.y < 0, else Infinity
ceilT  = (WALL_H - origin.y) / direction.y    if direction.y > 0, else Infinity
limit  = min(range, floorT, ceilT)
for t = 0.15; t < limit; t += 0.1:
    if level.isWallAt(origin.x + direction.x*t, origin.z + direction.z*t): wallT = t; break
return max(0.15, wallT)
```

The 0.1 sampling is a deliberate cheap grid march; it can be off by up to 10 cm and is not a DDA.
Then every alive enemy's AABB is intersected with `THREE.Ray.intersectBox`. Each box is centred at
`(x, height/2, z)` with size `(width * 0.72, height, width * 0.62)`:

| Enemy | Hitbox (x × y × z) |
| --- | --- |
| Trooper | 1.08 × 2.25 × 0.93 |
| Hound | 1.26 × 1.18 × 1.09 |
| Heavy | 1.55 × 2.75 × 1.33 |

The nearest enemy entry point closer than the wall distance wins. If none, the tracer ends at the
wall point. `headshot` is true when `hit.y > enemy.position.y + enemy.height * 0.8`.

Damage:

```text
plasma: 27, one pellet, range 44, cooldown 0.155 s
shotgun: 12 per pellet × 9, range 24, cooldown 0.82 s
shotgun falloff = clamp(1 - (distance / range) * 0.45, 0.52, 1)
headshot multiplier = 2
final damage = round(damage)
```

Enemy projectiles are `Projectile` instances with speed 8.8 (trooper) or 7.4 (heavy), damage 9 or 12,
life 4.5 s. Each frame is split into two substeps. A projectile hits a wall when
`level.isWallAt(x, z)` is true, hits a prop when inside `obstacle.radius + 0.08`, and hits the player
when `dx² + dz² < 0.34²` and `|y - (player.y + 1.05)| < 1.0`. Heavy enemies fire three bolts with a
±0.075 rad fan and per-shot jitter.

Incoming damage: armour absorbs `min(armor, incoming * 0.58)` and health takes the remainder. Armour
is spent, not merely checked.

## 7. Rendering pipeline

1. `resize()` computes an internal buffer:

```text
scale = clamp(min(settings.pixelScale, 1920/width, 1200/height), 0.42, 1)
buffer = (max(320, floor(width*scale)), max(240, floor(height*scale)))
canvas CSS size = 100% × 100%
```

   `image-rendering: pixelated` in `style.css` upscales the low-resolution buffer. `setPixelRatio(1)`
   keeps the buffer honest; device pixel ratio is intentionally ignored.

2. `DungeonLevel.build(scene)` adds one shared `BoxGeometry(CELL, WALL_H, CELL)` per wall cell with one
   of three shared `MeshLambertMaterial` wall textures. The variant is
   `(gx*7 + gz*13 + levelIndex) % 3`. Wall matrices are frozen with `matrixAutoUpdate = false`.
3. Floor and ceiling are `PlaneGeometry(size*CELL, size*CELL)` at `y = 0` and `y = WALL_H`; the floor
   texture repeats 8×8, the ceiling 5×5.
4. Props: up to seven crates/barrels/server pillars in room centres; lights: up to nine ceiling panels
   plus `PointLight`s; signs: up to eight billboard planes; exit: two torus rings, an additive vortex
   plane, pylons, pad, point light and a label sprite whose texture swaps `EXIT // SEALED` for
   `EXIT // ONLINE`.
5. Per level: `FogExp2(theme.fog, 0.036)`, `AmbientLight(theme.ambient, 0.7)`,
   `HemisphereLight(theme.light, 0x030605, 0.32)`, a camera-mounted `SpotLight` floodlight and a
   muzzle `PointLight`.
6. Every frame: `renderer.render(scene, camera)` after `update(dt)`. Screen shake translates the
   canvas with CSS (`translate3d(...) scale(1.018)`), not the camera.
7. CSS overlays (`fx-scanlines`, `fx-vignette`, `fx-noise`, `fx-damage`, `fx-flash`) sit above the
   canvas and are pointer-transparent.

Billboard anchoring: sprites use `center.set(0.5, 0)` for enemies so `sprite.position.y` is the feet
anchor; the enemy atlas is 3 frames of 64×96 px, sampled with `texture.repeat.set(1/3, 1)` and
`texture.offset.x = frame/3`. Each enemy clones the cached texture so frame offsets are independent.

## 8. Enemy and weapon systems

`ENEMY_TYPES` is the single source of truth (HP, speed, radius, height, width, sight, attack range,
preferred range, damage, cooldown, projectile speed, score, bob). `Enemy.update` implements:

```text
idle   → if canSee: alert; else after idleTime: choose patrol target
patrol → if canSee: alert; else follow path at speed*0.58
alert  → hold for alertTimer (0.48 s on spot), then chase
chase  → if canSee: attack when in range and cooldown ready; hold preferred range; strafe;
          re-path while far. If LOS lost: chase lastSeen for 3.2 s, then patrol.
dead   → fade/fall for 1.05 s, then hide
```

There is no separate `attack` state; attacking is a branch inside `chase`. `alertNearby()` wakes idle
allies within 8.5 units. `separate()` pushes overlapping enemies apart without entering walls.
`spotPlayer()` plays a growl plus alert sting.

Weapon state lives in `game.weapons`:

```js
{
  current: 'plasma' | 'shotgun',
  plasma:  { ammo: 0..240 },
  shotgun: { ammo: 0..72 }
}
```

Initial campaign ammo is 120 plasma cells and 24 shells. Switching sets `weaponRaise = 0`, which the
HUD converts into a 150 px raise animation. Recoil, muzzle timer, FOV kick, muzzle-light intensity,
crosshair kick, hit marker, screen shake, tracers and sparks are all driven from `fire()`.

Weapon table (`WEAPONS`):

| id | Max ammo | Damage | Cooldown | Pellets | Spread | Range | Colour |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `plasma` | 240 | 27 | 0.155 s | 1 | 0.004 | 44 | `0x63ffd3` |
| `shotgun` | 72 | 12 | 0.82 s | 9 | 0.072 | 24 | `0xffa83d` |

Enemy table (`ENEMY_TYPES`):

| id | HP | Speed | Radius | Height | Width | Sight | Attack range | Preferred | Damage | Cooldown | Projectile | Score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `trooper` | 64 | 2.15 | 0.39 | 2.25 | 1.50 | 15 | 11 | 6.2 | 9 | 1.55 s | 8.8 | 100 |
| `hound` | 38 | 3.75 | 0.36 | 1.18 | 1.75 | 13 | 1.55 | 1.1 | 14 | 0.95 s | — | 150 |
| `heavy` | 156 | 1.35 | 0.55 | 2.75 | 2.15 | 17 | 13 | 8.0 | 12 | 2.15 s | 7.4 | 300 |

All enemies have `bob` 0.035 (trooper), 0.055 (hound) and 0.025 (heavy). The heavy fires three
projectiles per attack; the other ranged type fires one. `hound` is the only melee archetype.

Pickup table (`PICKUP_TYPES`):

| id | Label | Amount | Cap |
| --- | --- | ---: | ---: |
| `health` | MEDKIT | 25 | 100 |
| `armor` | ARMOR SHARD | 25 | 100 |
| `plasma` | PLASMA CELLS | 35 | 240 |
| `shells` | SHOTGUN SHELLS | 9 | 72 |

Pickups are collected within 1.0 horizontal unit, even if the player is jumping. A full stat is not
consumed and the pickup stays on the floor.

## 9. HUD and audio

`HUD` caches every element once. `update(dt, game)` writes ammo, health, armour, score, kills,
accuracy, sector name, hostiles remaining, threat word, compass cardinal/bearing, interaction prompt,
health/armour bars and low-ammo/low-health classes. It redraws the 96×96 marine face and 900×420
weapon viewmodel every frame, and the 180×180 minimap every 0.09 s.

Face states are `steady` (>75), `worn` (>50), `wounded` (>25), `critical` (≤25); the status text adds
`STRAINED`, `HIT`, `FLATLINE`. Health thresholds also add grime, blood and sweat pixels. The face
blinks on a 4.2 s cycle, eyes track on a sine, and hurt/kill reactions are timed in `HUD.update`.

Minimap: walls, floor, pickups, living enemies, exit, a scanning line, player heading and a
±0.48 rad FOV wedge (drawn directly, not derived from the camera projection).

`SynthEngine` builds `master → DynamicsCompressor → destination`, plus an ambient gain bus. It creates
a 2-second brown-ish noise buffer, then `tone()` and `noise()` schedule oscillators/buffer sources
with exponential envelopes and optional biquad filters. `setVolume` uses
`(volume/100)^1.5 * 0.8`; `setDucked` lowers ambience to 0.18. `ensure()` must run after a user
gesture; `startNew()` and the fire/switch/pickup paths call it.

## 10. State, scoring and persistence

Runtime state:

```text
Game.mode: boot | title | playing | paused | levelclear | dying | dead | victory | fatal
Game.player: { position, velocity, verticalVelocity, onGround, health 0–100, armor 0–100, dead }
Game.score, kills, shotsFired, shotsHit, timePlayed, elapsed, levelIndex, levelSeed
Game.flashlightOn, weaponRecoil, fireCooldown, shake, touchMove, touchFire, keys
```

Scoring:

```text
trooper 100, hound 150, heavy 300; headshot +50
all hostiles dead: +250 and exit unlock
level clear bonus: 500 * (levelIndex + 1) + deadCount * 20 + round(health) * 5
victory rank: S ≥ 7500, A ≥ 6000, B ≥ 4500, C ≥ 3000, else D
accuracy = round(shotsHit / shotsFired * 100)   // shotsFired counts pellets
```

localStorage keys:

| Key | Shape | Written by |
| --- | --- | --- |
| `cyberdoom.autosave.v1` | run object (below) | `autosave()` every 3.8 s, pause, `beforeunload` |
| `cyberdoom.highscores.v1` | array of up to 8 score entries | `recordHighScore`, import merge |
| `cyberdoom.settings.v1` | `{sensitivity, volume, pixelScale, shake, muted}` | `saveSettings()` |

Autosave is removed on level clear, victory and death, so "Continue Run" never resumes a finished
run. `startNew()` generates a new 32-bit seed. `continueRun()`/`applyRun()` re-create the level from
`level` + `seed`, then restore player position (if collision-free), weapons, stats and entity lists.

Run shape (`Game.gatherRun()`):

```json
{
  "schema": 1,
  "version": "1.0.0",
  "savedAt": "ISO-8601",
  "level": 0,
  "seed": 1234567890,
  "player": { "x": 0, "y": 0, "z": 0, "yaw": 0, "pitch": 0,
              "health": 100, "armor": 0, "hasPosition": true },
  "weapons": { "current": "plasma", "plasma": { "ammo": 120 },
               "shotgun": { "ammo": 24 } },
  "stats": { "score": 0, "kills": 0, "shotsFired": 0, "shotsHit": 0,
             "timePlayed": 0 },
  "enemies": [{ "type": "trooper", "x": 0, "z": 0, "health": 64,
                "state": "idle", "dead": false }],
  "pickups": [{ "type": "health", "x": 0, "z": 0, "taken": false }]
}
```

The downloaded `cyberdoom_save.json` wraps that run:

```json
{
  "format": "cyberdoom-save",
  "schema": 1,
  "version": "1.0.0",
  "exportedAt": "ISO-8601",
  "run": { "...": "run shape above" },
  "highScores": [],
  "credits": { "builtWith": "OpenCode 2.2.5",
               "model": "DeepSeek V4.1 Flash (opencode-go/deepseek-v4.1-flash)",
               "engine": "Three.js r128" }
}
```

`sanitiseRun()` is a whitelist, not a patch. It returns `null` for a non-object, a non-integer or
out-of-range `level`, and a missing/non-positive seed becomes 1. It clamps every number, caps entity
arrays at 60, whitelists enemy/pickup types, and strips `<>` from strings. Import merges valid high
scores, sorts, and truncates to 8. It never applies a partial run: one throw rejects the payload.

## 11. Extension points

| Change | Touch |
| --- | --- |
| New enemy archetype | `ENEMY_TYPES`, `TextureFactory.enemyAtlas`/`draw*`, `Enemy.update` branch if it needs new behaviour, `LevelConfig.enemies` |
| New weapon | `WEAPONS`, `Game.fire` branch, `HUD.drawWeapon`, `weapons` state, ammo pickup, save defaults |
| New sector | `LEVELS` (size, rooms, braid, roster, theme), `addSigns` text, `buildExportPayload` level clamp |
| New pickup | `PICKUP_TYPES`, `TextureFactory.pickup`, `collectPickup` |
| New save field | `gatherRun`, `sanitiseRun`, `applyRun`, `beginLevel`, docs and `scripts/check.mjs` |
| New HUD panel | `index.html`, `HUD.elements` + `HUD.update`, `style.css`, responsive rules |

Keep `VERSION`, `BUILD`, `SAVE_SCHEMA` and the credits block consistent when releasing. The skill
template at [skills/cyberdoom-retro-fps/assets/template](../skills/cyberdoom-retro-fps/assets/template)
must stay byte-identical to the three root source files.

## 12. Input contract

Input is read from `document` (keyboard, mouse, wheel, pointer-lock events) and from the touch zones
in `#touch-ui`. There is no gamepad support and no pointer-lock requirement on touch devices.

### Keyboard

`Game.onKeyDown` ignores events whose target is `INPUT`, `TEXTAREA` or `SELECT`, and ignores
`Space`/`Enter` when the target is a `BUTTON` or `A` (so focused buttons still activate normally).
It calls `preventDefault()` for `Space` and all four arrow keys.

Mode gating comes first:

| Mode | Key | Action |
| --- | --- | --- |
| `title` | `Enter` | `startNew()` |
| `levelclear` | `Enter` / `Space` | `nextLevel()` |
| `gameover` | `Enter` / `Space` | `retrySector()` |
| `victory` | `Enter` | `startNew()` |
| `paused` | `KeyP` / `Escape` | `resumeGame()` |
| any other non-`playing` mode | — | no gameplay input |

In `playing`, the code is added to `Game.keys`; auto-repeat returns before the action switch. The
action switch is:

| Input | Action |
| --- | --- |
| `Space` | `tryInteract()` if within 3.6 units of the exit; otherwise queue a jump |
| `Digit1` | switch to plasma |
| `Digit2` | switch to shotgun |
| `KeyQ` | toggle plasma ⇄ shotgun |
| `KeyF` | toggle the suit floodlight |
| `KeyM` | toggle mute and persist the setting |
| `Escape` / `KeyP` | `pauseGame()` |

`onKeyUp` removes the code from the set. Movement is polled in `Game.updatePlayer`, not applied on
keydown:

```text
W / ArrowUp    forward  +1
S / ArrowDown  forward  -1
D / ArrowRight strafe   +1
A / ArrowLeft  strafe   -1
ShiftLeft or ShiftRight → sprint speed 7.4 instead of 5.4
forward/strafe clamped to [-1, 1]; touch axes are added before clamping
```

`window.blur` clears `keys` and pauses if playing; `visibilitychange` to hidden also pauses. This is
why the player does not keep walking after alt-tab.

### Mouse and pointer lock

- `mousedown` with `button !== 0` is ignored. In `playing` on a non-touch device: if the pointer is
  not locked, `requestLock()` and return; if locked, `fire()`.
- `wheel` is handled only in `playing`, calls `preventDefault()`, and toggles the weapon.
- Clicking the canvas while playing, unlocked and non-touch calls `requestLock()`.
- `pointerlockchange`: acquiring the lock clears `lockRequested` and resumes a paused game;
  losing the lock while playing on a non-touch device calls `pauseGame()`.
- `pointerlockerror` clears `lockRequested` and shows “Mouse capture blocked — click the viewport to
  retry”.
- `requestLock()` is skipped when `isTouch` or `isHeadless`; the `controls.lock` wrapper catches a
  rejected `requestPointerLock()` promise.
- `PointerLockControls.pointerSpeed` is set from `settings.sensitivity` (0.3–2). The fallback controls
  use `0.002 * sensitivity` per pixel and clamp pitch to ±(π/2 − 0.02).

### Touch

`isTouch` is `matchMedia('(pointer: coarse)').matches` at construction. Touch zones use pointer events
with pointer capture, so a finger can leave the element without losing the gesture.

| Zone | Behaviour |
| --- | --- |
| Move (`#touch-move-zone`) | On pointerdown, record the zone centre; on move, clamp the offset to a 40 px radius. `touchMove.x = dx/40`, `touchMove.y = -dy/40` (screen Y is inverted). Released by pointerup, pointercancel or lostpointercapture. |
| Look (`#touch-look-zone`) | On move, `lookYaw -= dx * 0.0048 * sensitivity`, `lookPitch -= dy * 0.0048 * sensitivity`, pitch clamped to ±1.35 rad. |
| Fire (`#touch-fire`) | Pointerdown sets `touchFire = true` and calls `fire()` immediately; `updateWeapons` keeps firing while held and the cooldown allows. Released on pointerup, pointercancel or pointerleave. |
| Jump (`#touch-jump`) | Pointerdown calls `tryInteract()`; if not near the exit, queues a jump. |
| Swap (`#touch-swap`) | Pointerdown toggles plasma ⇄ shotgun. |

There is no on-screen pause button; touch users need an external keyboard or must rely on the
pointer-lock/visibility pause paths. The HUD key hints are hidden at the narrow breakpoints, and the
title’s manual note is replaced with touch instructions when `isTouch` is true.

### Interaction range

`tryInteract()` uses horizontal distance `< 3.6` to `level.exitWorld`. If the exit is unlocked it
calls `completeLevel()`; otherwise it shows `EXIT SEALED // <n> HOSTILES REMAIN`. Separately,
`checkExit()` runs every playing frame and completes the level automatically when the horizontal
distance is `< 1.45`, so walking into an unlocked portal is sufficient without pressing Space.

