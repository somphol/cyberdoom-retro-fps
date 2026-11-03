# Attribution

## Origin

This skill packages **CYBERDOOM — Retro 3D First-Person Shooter Studio**, built in a single OpenCode
session on 2026-11-01 with **DeepSeek V4.1 Flash** (`opencode-go/deepseek-v4.1-flash`, harness
OpenCode 2.2.5). The original brief asked for a production-ready, 100% client-side retro FPS in
vanilla HTML/CSS/ES6 with Three.js r128, PointerLockControls, procedural art and audio, a Doom-style
status bar, localStorage autosave and JSON save transfer.

The release source lives at `~/Projects/cyberdoom-retro-fps` and is published at
<https://somphol.github.io/cyberdoom-retro-fps/>. The template under `assets/template/` is copied
byte-for-byte from that release (`index.html`, `style.css`, `script.js`).

## What is new here

- The complete three-file game: seeded maze/room generator, collision, line of sight, A* enemies,
  billboard sprites, hitscan combat, procedural Canvas 2D art, Web Audio synthesis, HUD, touch
  controls, saves and the 17-check in-browser self-test.
- The build knowledge in `references/method.md` (order, constants, invariants), `references/lessons.md`
  (bugs and regressions) and `references/verification.md` (checks and expected results).
- No engine, framework, art pack, sound pack or level editor was used. Every visual and sound is
  generated at runtime by the code in the template.

## Licence status

| Component | Licence | Notes |
| --- | --- | --- |
| CYBERDOOM source and template | MIT | Copyright (c) 2026 Somphol Boonjing. See the project `LICENSE`. |
| Three.js r128 | MIT | Loaded from cdnjs at runtime; not bundled. |
| PointerLockControls (Three.js r128 examples) | MIT | Loaded from jsDelivr at runtime; not bundled. |
| Press Start 2P | SIL OFL 1.1 | Loaded from Google Fonts; not bundled. |
| Rajdhani | SIL OFL 1.1 | Loaded from Google Fonts; not bundled. |
| Share Tech Mono | SIL OFL 1.1 | Loaded from Google Fonts; not bundled. |

No third-party images, textures, audio files, 3D models or fonts are included in this skill. The
procedural output is original to the project and covered by the project MIT licence. If you reuse the
template, keep the MIT notice and the third-party notices for the CDN libraries and fonts.
