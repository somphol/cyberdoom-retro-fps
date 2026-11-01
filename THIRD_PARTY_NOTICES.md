# Third-Party Notices

CYBERDOOM is a vanilla static web application. It does not bundle any third-party
images, textures, audio files, fonts or 3D models in this repository.

## Runtime dependencies loaded from CDNs

| Component | Version | License | Source |
| --- | --- | --- | --- |
| Three.js | r128 | MIT | <https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js> |
| PointerLockControls | Three.js r128 examples | MIT | <https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/PointerLockControls.js> |

Three.js copyright © 2010–2021 three.js authors. See <https://github.com/mrdoob/three.js/blob/r128/LICENSE>.

## Typefaces

Loaded from Google Fonts under the SIL Open Font License 1.1:

- **Press Start 2P** — CodeMan38
- **Rajdhani** — Indian Type Foundry
- **Share Tech Mono** — Carrois Type Design

See <https://fonts.google.com/> for individual font licenses.

## Generated assets

All wall, floor, ceiling, crate, enemy, pickup, weapon, portrait, minimap, portal,
icon and signage artwork is drawn procedurally with the Canvas 2D API at runtime.
All sound effects and ambience are synthesised with the Web Audio API. No external
media assets are required.
