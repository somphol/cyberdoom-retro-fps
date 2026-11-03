# Method

How to build or extend the reference game without guessing. The template in `assets/template/` is
the source of truth; this file explains the order and the numbers behind it.

## 1. Build order

Build in this order. Each stage is playable or inspectable before the next.

1. **Shell.** `index.html`: canvas, five FX layers, HUD, title/pause/clear/victory/game-over screens,
   loading screen, fatal card, toast, touch UI, hidden file input, CDN scripts in the right order.
2. **Frame.** `style.css`: tokens, full-screen app, pixelated canvas, CRT overlays, HUD status bar,
   screen modals, responsive breakpoints, reduced motion.
3. **Constants and storage.** `CELL`, `WALL_H`, `EYE_HEIGHT`, `PLAYER_RADIUS`, movement constants,
   `MAX_DT`, safe storage helpers, sanitizers, seeded RNG.
4. **Settings and audio.** Defaults, load/save, `SynthEngine` with lazy context and noise buffer.
5. **Data tables.** `WEAPONS`, `ENEMY_TYPES`, `LEVELS`, `PICKUP_TYPES`.
6. **Procedural art.** Canvas helpers, `toTexture`, all `TextureFactory` methods, `ParticleField`,
   `TracerPool`.
7. **World.** `DungeonLevel`: generation → BFS → collision/LOS/A* → meshes/props/lights/portal.
8. **Entities.** `Enemy` (sprite, state machine, attacks), `Projectile`, `Pickup`.
9. **HUD.** Values, bars, face, weapon, minimap, compass, prompts, messages.
10. **Game.** Renderer/camera/controls, input, physics, combat, flow, autosave, export/import,
    self-test, loop.
11. **Release.** Docs, checks, `.nojekyll`, screenshots, Pages.

Do not start with the renderer. A reachable, collidable grid first makes every later bug visual and
local.

## 2. Locked constants

| Constant | Value | Coupled to |
| --- | --- | --- |
| `CELL` | 2.8 | Collision, props, portal, spawn, minimap |
| `WALL_H` | 3.7 | Walls, ceiling, lights, portal, projectile bounds |
| `EYE_HEIGHT` | 1.62 | Camera and its child lights |
| `PLAYER_RADIUS` | 0.42 | Movement, spawn safety, tests |
| `GRAVITY` | 19.5 | Jump arc |
| `JUMP_SPEED` | 6.4 | Apex ≈ 1.05 m |
| `WALK_SPEED` | 5.4 | Footstep cadence, bob |
| `SPRINT_SPEED` | 7.4 | Footstep cadence |
| `MAX_DT` | 0.05 | Simulation stability |
| Camera FOV | 72° vertical | Weapon FOV kick adds up to ~3.4° (`fovKick * 2.4`) |
| Camera near/far | 0.05 / 70 | Fog hides the far clip |
| Autosave | 3.8 s | localStorage writes |
| Max high scores | 8 | High-score table |
| Save format/schema | `cyberdoom-save` / `1` | Import/export |

If any of `CELL`, `WALL_H`, `EYE_HEIGHT`, `PLAYER_RADIUS` changes, re-test: corridor corners, prop
overlap, start spawn, portal approach, enemy pathing, projectile ceiling/floor checks and the mobile
HUD. They are not independent knobs.

## 3. Map format and generation invariants

```text
grid[z][x] = 0 open | 1 wall
size ∈ {23, 25, 27}
half = size * CELL / 2
world(gx,gz) = ((gx+0.5)*CELL - half, (gz+0.5)*CELL - half)
cellAt(x,z)  = (floor((x+half)/CELL), floor((z+half)/CELL))
```

Generation order: maze → rooms → braid → seal border → start/exit → BFS → open cells.

Invariants:

- The outer ring is always wall.
- The maze is carved on odd coordinates; rooms are odd-aligned with a one-cell buffer.
- Start and exit are reachable; exit is the farthest reachable room from the start (or farthest
  reachable cell).
- The 3×3 around the exit is opened before the final BFS.
- `openCells` contains only cells with `distanceMap >= 0`.
- Enemies normally spawn at distance ≥ 4 with Manhattan spacing ≥ 2; a failsafe pass may reuse a
  nearer reachable cell if the roster cannot be placed. Pickups spawn at distance ≥ 2. Neither may
  use the start or exit.
- The level structure is deterministic for a seed. Cosmetics (prop offsets, texture speckle) use
  `Math.random` and are not deterministic.

Collision is circle-vs-cell with axis-separated sliding. LOS is point sampling every 0.22 units. A*
is four-neighbour with Manhattan heuristic and a 2,500-node guard.

## 4. Rendering recipe

- One `WebGLRenderer`, `setPixelRatio(1)`, internal size = window × `pixelScale`, capped to
  1920×1200 and floored at 0.42. CSS stretches the canvas to 100% with `image-rendering: pixelated`.
- Camera rotation order `YXZ`; look state is `lookYaw`/`lookPitch`; pitch clamp ±1.35.
- One shared `BoxGeometry(CELL, WALL_H, CELL)` for every wall; three shared wall materials selected
  by `(gx*7 + gz*13 + levelIndex) % 3`. Freeze each wall matrix after `updateMatrix()`.
- Floor/ceiling planes at `y = 0` and `y = WALL_H`, size `size*CELL`.
- Fog `FogExp2(theme.fog, 0.036)`, ambient + hemisphere, up to nine ceiling point lights, a camera
  spot floodlight, a muzzle point light.
- Enemies/pickups/signs/portal labels are sprites. Enemy sprites anchor at the feet
  (`center.set(0.5, 0)`), use a 3-frame 64×96 atlas and clone the texture per enemy.
- Particles are one pooled `THREE.Points` (280). Tracers are 20 pooled `THREE.Line`s.
- Screen shake moves the canvas with CSS, not the camera.

## 5. Hitscan and damage recipe

```text
forward = camera.getWorldDirection()
right   = normalize(-forward.z, 0, forward.x)
up      = normalize(cross(right, forward))
muzzle  = origin + forward*0.7 + right*0.18 - up*0.14
```

For each pellet: perturb by `rand(-spread, spread)` along right/up, normalize, then:

1. `wallDistance = rayWallDistance(origin, direction, range)`.
2. For each alive enemy, `ray.intersectBox(enemy.box)`; keep the nearest hit ≤ `wallDistance`.
3. End point is the enemy hit or the wall point.
4. `headshot = hit.y > enemy.y + enemy.height * 0.8`.
5. Damage: plasma 27; shotgun 12 with falloff; headshot ×2; round.
6. Spawn sparks, tracer, hit marker, face reaction, score/kill.

`rayWallDistance` clamps to floor/ceiling intercepts and steps 0.1 from 0.15. The hitbox is
`(width*0.72, height, width*0.62)` centred at `height/2`. This is intentionally cheaper and more
forgiving than a mesh raycast.

Enemy projectiles: move in two substeps per frame; hit floor/ceiling, wall cell, prop circle, or
player (`dx²+dz² < 0.34²` and `|dy| < 1.0`). Armour absorbs `min(armor, incoming*0.58)`.

## 6. Enemy AI recipe

States: `idle`, `patrol`, `alert`, `chase`, `dead`. Attacks are inside `chase`; there is no separate
`attack` state.

- `canSee = distance <= sight && level.hasLineOfSight(...)`.
- `idle`: after `idleTime` pick a patrol target; if `canSee`, `alert`.
- `patrol`: follow path at `speed*0.58`; on `canSee`, `alert`.
- `alert`: hold 0.48 s (or until timer), then `chase`; copies `lastSeen`.
- `chase`: if visible, fire/melee when in range and cooldown ready; otherwise approach to
  `preferredRange`, back off if too close, strafe while holding a line. If LOS is lost, path to
  `lastSeen` for 3.2 s, then patrol.
- `dead`: fade/fall for 1.05 s, then hide.
- `alertNearby` wakes idle allies within 8.5 units.
- `separate` pushes overlapping enemies apart without entering walls.
- Re-path on timers (0.55–0.9 s chase, 1.1 s last-seen, 1.6–3.1 s patrol), not every frame.

Archetype numbers are in `ENEMY_TYPES`; do not duplicate them in docs or tests without a reason.

## 7. Save recipe

localStorage:

```text
cyberdoom.autosave.v1   run object
cyberdoom.highscores.v1 array (max 8)
cyberdoom.settings.v1   { sensitivity, volume, pixelScale, shake, muted }
```

Run object:

```js
{
  schema: 1, version: '1.0.0', savedAt: ISO,
  level, seed,
  player: { x, y, z, yaw, pitch, health, armor, hasPosition },
  weapons: { current, plasma:{ammo}, shotgun:{ammo} },
  stats: { score, kills, shotsFired, shotsHit, timePlayed },
  enemies: [{ type, x, z, health, state, dead }],
  pickups: [{ type, x, z, taken }]
}
```

Download wrapper: `{ format:'cyberdoom-save', schema:1, version, exportedAt, run, highScores, credits }`.

Rules:

- `gatherRun` rounds positions to 3 decimals and angles to 4.
- `sanitiseRun` rejects non-objects, non-integer/out-of-range level, and returns `null`; it clamps
  seed to `[1, 2³²−1]`, numbers to documented ranges, arrays to 60, types to whitelists, and strips
  `<>` from strings.
- Restore re-creates the level from `level + seed`, then applies player/weapons/stats/entities.
- Player position is used only if collision-free; otherwise the level start is used.
- Autosave is removed on clear, victory and death.
- Never save the grid or prop offsets unless you also change the loader; they are regenerated.

## 8. HUD and audio recipe

- Cache elements once; write only when the text changes.
- Status bar: ammo, health, armour, score, kills, accuracy, weapon chips, face, bars.
- Face: health bands at 75/50/25; mood, blink, eye drift, hurt/kill reactions.
- Weapon: 900×420 canvas, bob/sway from `bobPhase` and velocity, recoil from `weaponRecoil`, raise
  from `weaponRaise`.
- Minimap: 180×180, redraw every 0.09 s; walls, floor, pickups, nearby enemies, exit, scan line,
  heading/FOV wedge.
- Messages: max 4, default 3.4 s; toast 2.6 s.
- Audio: one `AudioContext` after a gesture; master gain → compressor → destination; ambient bus
  ducked on pause/menus; every effect is a short oscillator/noise envelope.

## 9. Release recipe

```sh
node --check script.js
node scripts/check.mjs
python3 -m http.server 8000
# browser: ?selftest=1 → 17/17
git add -A
git commit -m "feat: ..."
git push origin main
```

Pages: `main` / root, `.nojekyll`. After deploy, compare `script.js` hashes and check 200s. Keep the
skill template byte-identical if the project ships one.
