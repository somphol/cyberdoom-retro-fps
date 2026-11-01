# Build State

| Field | Value |
| --- | --- |
| Project | **CYBERDOOM — Retro 3D First-Person Shooter Studio** (`cyberdoom-retro-fps`) |
| Started | 2026-11-01 04:42:50 UTC |
| Packaged | 2026-11-01 05:13:41 UTC |
| Duration | **30m 51s** (1,851 seconds) |
| Harness | OpenCode 2.2.5 |
| Model | DeepSeek V4.1 Flash (`opencode-go/deepseek-v4.1-flash`) |
| Session | `ses_e6a9523f4ffehQyAWD8OX7Xk0v` |
| Repository | <https://github.com/somphol/cyberdoom-retro-fps> |
| Live demo | <https://somphol.github.io/cyberdoom-retro-fps/> |

## Token usage

| Metric | Tokens |
| --- | ---: |
| Input | 487,400 |
| Output | 127,158 |
| Reasoning | 118,967 |
| **Total (input + output + reasoning)** | **733,525** |
| Cache read | 16,392,320 |
| Cache write | 1,169 |
| Total including cache | 17,127,014 |

> Snapshot taken from the OpenCode session record at packaging time. The final state commit, GitHub push and Pages verification happen outside this snapshot, so the live session totals will be marginally higher. Total cost reported by the session: **$0.00**.

## What was built

- A complete retro 3D FPS in three modular files:
  - `index.html` — 21,221 bytes, 360 lines
  - `style.css` — 46,879 bytes, 1542 lines
  - `script.js` — 206,441 bytes, 5576 lines
- Three procedurally generated sectors (Docking Bay Seven, Reactor Spine, The Cyber Core) using seeded mazes, carved rooms, braided loops, BFS reachability and A* enemy navigation.
- Procedural Canvas 2D art for every wall, floor, ceiling, crate, barrel, sign, enemy, pickup, weapon, marine portrait, minimap, portal and icon.
- Billboarded Cult Troopers, Cyber Hounds and Siege Cyborgs with idle → patrol → alert → chase → attack state machines, line-of-sight checks, alert propagation and projectile attacks.
- Plasma Gun and Super Shotgun hitscan combat with headshots, pellet spread, range falloff, hit sparks, tracers, recoil, sway, muzzle-flash point light, screen shake and hit markers.
- Fully synthesised Web Audio: plasma/shotgun reports, dry fire, weapon switches, growls, alert stings, enemy shots, footsteps, jumps, pickups, hurt, death, portal, clear fanfare and victory chime.
- Doom-style status bar with animated marine face, health/armour bars, ammo, score, kills and accuracy.
- Minimap, compass, objective tracker, threat state, message feed and context prompts.
- localStorage autosave, JSON export to `cyberdoom_save.json`, validated import and merged high scores.
- Responsive desktop and touch layouts with virtual joystick, look pad, fire/jump/swap buttons.
- 17-check built-in self-test surface and headless Chrome end-to-end verification.

## Verification

- **17/17** self-tests pass.
- Headless Chrome end-to-end runs verified:
  - new campaign, procedural sector generation and HUD mount,
  - plasma/shotgun damage, kill scoring and hit particles,
  - enemy AI aggro, chase and projectile damage,
  - health/armour absorption and portrait changes,
  - autosave → title → continue restoration,
  - pause/resume, save export and file-input import,
  - exit unlock, Space interaction, sector transitions and victory,
  - high-score persistence across reload,
  - death → game over → retry,
  - settings persistence and resolution changes,
  - mobile 390×844 touch layout,
  - **0 uncaught exceptions** and **0 console errors**.
- Rendering: ~194 draw calls, ~3,684 triangles, ~57 FPS at 1600×1000 in the test environment.

## Files

| File | Size |
| --- | ---: |
| `index.html` | 21,221 bytes |
| `style.css` | 46,879 bytes |
| `script.js` | 206,441 bytes |
| `README.md` | 10,546 bytes |
| `screenshot.png` | 1,059,814 bytes |
| `screenshot-start.png` | 564,028 bytes |
| `screenshot-portal.png` | 1,133,594 bytes |
| `screenshot-mobile.png` | 881,239 bytes |
| `screenshot-victory.png` | 372,205 bytes |

## Credits

Built with [OpenCode](https://opencode.ai) 2.2.5 and **DeepSeek V4.1 Flash** (`opencode-go/deepseek-v4.1-flash`) in a single agent session. The game code, procedural textures, sprites, weapon and portrait art, level generator, AI, HUD, audio synthesis, save system and verification harness were generated for this project.

Runtime libraries: [Three.js](https://threejs.org/) r128 (MIT) and PointerLockControls from the Three.js r128 examples (MIT). Typefaces: **Press Start 2P**, **Rajdhani** and **Share Tech Mono** from Google Fonts (SIL OFL 1.1). No image, texture, audio or 3D model assets are used. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
