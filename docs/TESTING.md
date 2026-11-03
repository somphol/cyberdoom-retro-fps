# Testing

This page separates three things: checks that were actually run, checks recorded from the build
session, and things that are reasoned but **not verified**. A claim without evidence is labelled
manual or not verified.

## 1. Commands

```bash
cd ~/Projects/cyberdoom-retro-fps

# static
node --check script.js
node scripts/check.mjs
node ~/.config/opencode/skills/skill-publish/scripts/check-skill.mjs skills/cyberdoom-retro-fps

# serve
python3 -m http.server 8000
# open http://localhost:8000/

# in-browser self-test
# http://localhost:8000/?selftest=1

# live
# https://somphol.github.io/cyberdoom-retro-fps/?selftest=1
```

`scripts/check.mjs` is dependency-free and checks: required release files, every local `src`/`href`
in `index.html`, relative Markdown links in `README.md`, `AGENTS.md` and `docs/*.md`, `node --check`
for every `.js` file (including the skill template), JSON parsing, and byte-identity of the skill
template. It prints `OK <n> checks` on success.

## 2. Run during the documentation commit (2026-11-02)

| Check | Type | Result |
| --- | --- | --- |
| `node --check script.js` | static | **Pass** |
| `node scripts/check.mjs` | static | **Pass** — `OK 85 checks` |
| `check-skill.mjs skills/cyberdoom-retro-fps` | static | **Pass** — 8 files, 0.30 MB |
| `?selftest=1` in headless Chrome 156 (SwiftShader) | browser | **Pass** — 17/17, `data-selftest="17/17"` |
| Skill template vs root sources | byte compare | **Pass** — all three files identical |
| `git status` / diff review | manual | **Pass** — documentation and skill only; no app behaviour changed |
| Live root, `script.js`, `style.css`, `favicon.svg`, social card, `state.json` | HTTP HEAD/GET | **Pass** — all 200 before the docs push |
| Deployed `script.js` SHA-256 vs local | hash compare | **Pass** before the docs push |

The app code, build artefacts and `state.json` were deliberately not modified, so no new gameplay
run was performed for this documentation commit. The browser results below are from the build
session that produced v1.0.0.

## 3. Built-in self-test

Run with `?selftest=1`. It executes in the browser after 1.5 s and writes
`data-selftest="<passed>/<total>"` on `<html>`. The final build session recorded **17/17**; it was
re-run headlessly against the release source on 2026-11-02 and again reported **17/17**.

| # | Check | What it proves |
| --- | --- | --- |
| 1 | Three.js r128 loaded | CDN reachable and revision is 128 |
| 2 | PointerLockControls API present | `lock` and `getObject` exist |
| 3 | WebGL renderer online | `renderer.getContext()` returns a context |
| 4 | Dungeon generated | Seed `0xC0FFEE` yields > 80 open cells |
| 5 | Exit reachable from start | BFS distance from start to exit > 10 |
| 6 | Start and exit are walkable | Both cells are not walls |
| 7 | Start is collision free | `collides(start, PLAYER_RADIUS)` is false |
| 8 | Walls collide | A known wall cell collides at radius 0.3 |
| 9 | Pathfinding resolves start to exit | A* returns a non-empty path |
| 10 | Two weapons configured | Two entries; plasma damage > 0; shotgun pellets > 1 |
| 11 | Three enemy archetypes configured | Exactly three types |
| 12 | Four pickup types configured | Exactly four types |
| 13 | HUD elements mounted | `#health-value`, `#ammo-value`, `#score-value`, `#face-canvas`, `#minimap`, `#weapon-canvas` exist |
| 14 | Web Audio API available | `AudioContext` or `webkitAudioContext` is a function |
| 15 | Save sanitisation roundtrip | A sample run survives with expected level/ammo/score/enemy count |
| 16 | Save validator rejects malformed input | `sanitiseRun({level: 99})` and `sanitiseRun(null)` return `null` |
| 17 | High score archive readable | `loadHighScores()` returns an array |

Historical note: the first run was **16/17** because the validator clamped an out-of-range level
instead of rejecting it. The strict check was added and the final build run recorded 17/17. The bug
is documented in [REPRODUCTION §9](REPRODUCTION.md#9-what-was-tried-rejected-or-fixed).

The self-test does **not** cover: rendering output, pointer lock, audio output, touch input, save
download/import through the file picker, level transitions or victory. Those were exercised manually
or through headless Chrome, as below.

## 4. Browser runs recorded from the build session

Environment: headless Chrome via CDP, SwiftShader, 1600×1000 desktop and 390×844 mobile with touch
emulation. These were run against the local server during the build; the final run reported
**0 uncaught exceptions** and **0 console errors**.

| Area | Scenario | Result |
| --- | --- | --- |
| Boot | New campaign, sector generation, HUD mount | Pass |
| Combat | Plasma hitscan damage, hit sparks, kill scoring | Pass |
| Combat | Shotgun pellet spread, falloff, kill scoring | Pass |
| Damage | Enemy projectile hit, armour absorption, face reaction | Pass |
| Persistence | Autosave → title → Continue restores sector, ammo, health, score, enemies | Pass |
| Persistence | Pause → export `cyberdoom_save.json` | Pass |
| Persistence | Real file-input import of the exported save | Pass |
| Flow | Kill all → exit unlock → Space interaction → clear overlay → next sector | Pass |
| Flow | All three sectors → victory screen | Pass |
| Flow | Victory → high score recorded → persists across reload | Pass |
| Flow | Death → game over → retry sector | Pass |
| Settings | Sensitivity, volume, resolution and shake persist across reload | Pass |
| Layout | 1600×1000 desktop, HUD and screens | Pass |
| Layout | 390×844 touch, joystick/look pad/fire/jump/swap | Pass |
| Layout | Mobile `scrollWidth === innerWidth === 390` | Pass |
| Rendering | ~194 draw calls, ~3,684 triangles, ~57 FPS at 1600×1000 | Observed once; environment-specific |

The mobile run used touch emulation (`Emulation.setTouchEmulationEnabled`) and device metrics; it is
not a real-device test.

## 5. Manual test matrix

Use this when changing gameplay, input, HUD or saves. “Manual” means a human or an agent driving a
real browser; it is not automated in this repository.

### Desktop

| Test | Steps | Expected |
| --- | --- | --- |
| New campaign | Click **NEW CAMPAIGN** | Loading finishes, HUD appears, player starts in sector 01, pointer lock requests on click |
| Movement | `W A S D`, arrows, `Shift` | Walk/strafe/sprint; no wall clipping; jump with `Space` |
| Look | Move the mouse after lock | Camera yaw/pitch follows; pitch stops at ±1.35 rad |
| Plasma | `1`, left click | Tracer, muzzle flash, recoil, hit sparks, damage |
| Shotgun | `2`, left click | 9 pellets, wider spread, range falloff, heavier shake |
| Ammo | Fire until empty | Dry-fire click, “OUT OF AMMO” message, switch weapon |
| Enemy AI | Break line of sight | Enemy chases last-seen point, then patrols |
| Damage | Let a trooper/hound hit you | Health drops; armour absorbs part; face changes; red vignette |
| Death | Stand in fire until 0 HP | Fall animation, game over, **RETRY SECTOR** restores 55 HP / ≥25 armour |
| Pause | `Esc` or `P` | Pause screen; sector is frozen; resume re-locks |
| Portal | Kill all hostiles | Portal turns green, prompt changes, +250 score |
| Clear | Walk into the portal or press `Space` | Clear screen with kills/time/bonus; next sector starts |
| Victory | Clear sector 03 | Victory screen with rank, accuracy, time; high score recorded |
| Save | Pause → **SAVE GAME STATE** | `cyberdoom_save.json` downloads with format/schema/run |
| Import | Title → **LOAD GAME STATE** → pick file | Run restores; invalid file shows an error toast and does not apply |
| Continue | Reload mid-run → **CONTINUE RUN** | Sector, seed, position, health, armour, ammo, score, enemies, pickups restore |

### Mobile (390×844, portrait)

| Test | Expected |
| --- | --- |
| Title layout | No horizontal overflow; menu buttons reachable |
| Touch UI | Joystick, look zone, FIRE, JUMP, SWAP visible once playing |
| Move | Drag the left stick; player moves relative to look direction |
| Look | Drag the right zone; yaw/pitch change with sensitivity |
| Fire | Press/hold FIRE; weapon fires at cooldown |
| Jump | JUMP jumps; near an unlocked portal it interacts instead |
| Swap | SWAP toggles plasma/shotgun |
| HUD | Ammo/vitals/armour/score readable; no overlap with touch pads |
| Pause | `Esc`/`P` works with an external keyboard; otherwise no on-screen pause |

### Persistence and storage

| Test | Expected |
| --- | --- |
| Autosave cadence | A run saves about every 3.8 s while playing |
| Pause save | Pausing forces an autosave |
| Unload save | Closing/reloading while playing forces an autosave |
| Clear/death/victory | Autosave is removed; Continue is disabled |
| High scores | Up to 8 stored, top 5 shown on the title screen |
| Blocked storage | `safeGet/safeSet` fail silently; the game continues in memory |
| Save import edge cases | `level` 0–2 only; seed ≥ 1; arrays capped at 60; types whitelisted |

### Audio

| Test | Expected |
| --- | --- |
| First gesture | AudioContext is created/resumed on the first click or key |
| Weapons | Distinct plasma and shotgun reports |
| Enemies | Growl on spot, alert sting, shot/hit sounds |
| Ambience | Low drone and occasional pings; ducked on pause/menus |
| Mute | `M` toggles mute; volume slider changes level; settings persist |

Audio **output** was not captured or measured in headless Chrome. The self-test only proves the API
exists.

## 6. What was reasoned but not verified

| Claim | Status |
| --- | --- |
| Firefox and Safari work | **Not verified.** Standard Canvas/WebGL/Pointer Lock APIs are used, but no automated run exists. |
| Landscape phones and tablets | **Not verified.** Only 390×844 portrait was emulated. |
| Real touch hardware | **Not verified.** Touch was emulated through CDP. |
| Long-session stability | **Not verified.** No soak test or memory-leak profile. |
| CDN outage behaviour | Partially reasoned: missing Three.js shows the fatal screen; fonts fall back. The exact blocked-CDN path was not re-tested. |
| Save fidelity across level reload | **Known limitation.** Prop offsets use `Math.random` and are not saved; the grid is regenerated from the seed. |
| Seed 0 round-trip | **Known edge case.** The sanitizer clamps seed to ≥ 1. |
| Exact hardware frame rate | **Not measured.** ~57 FPS came from SwiftShader at 1600×1000; a real GPU will differ. |
| Accessibility | **Incomplete by design.** No keyboard-only aiming, no screen-reader world model, no modal focus trap. |
| All enemy edge cases | **Not exhaustively tested.** State transitions, LOS loss, separation and ranged/melee attacks were exercised, but not every combination. |

## 7. Known testing gaps

- No CI workflow; all checks are local and browser results are ad hoc.
- No checked-in headless-browser harness, so `scripts/check.mjs` cannot replay the 17 self-tests.
- The self-test depends on CDN availability and WebGL; it cannot run in a bare Node process.
- Pointer lock is intentionally skipped when `navigator.webdriver` or `HeadlessChrome` is detected,
  so headless runs verify gameplay logic but not real mouse capture.
- Audio is verified as an API, not as audible output.
- No performance budget or regression threshold is enforced.

If you add a check, prefer extending `scripts/check.mjs` for static invariants and the in-browser
`Game.selfTest()` for runtime invariants. Do not claim a browser result in the README or docs unless
it was actually run and recorded.
