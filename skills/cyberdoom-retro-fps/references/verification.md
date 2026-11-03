# Verification

Exact checks and expected results. Run static checks first; they are fast and catch broken paths,
syntax and template drift. Browser checks are separate and cannot be replaced by the static script.

## 1. Static checks

```sh
cd ~/Projects/cyberdoom-retro-fps
node --check script.js
node scripts/check.mjs
node ~/.config/opencode/skills/skill-publish/scripts/check-skill.mjs skills/cyberdoom-retro-fps
```

Expected:

```text
OK <n> checks
```

`<n>` is the number of checks the script actually ran (required files, local HTML refs, Markdown
links, JS syntax, JSON files and three template byte comparisons). Do not assume a historical count;
read the output.

If a check fails, the script prints `FAIL <reason>` and exits 1. Common causes:

| Failure | Fix |
| --- | --- |
| `required file ...` | Missing doc, skill file or template file |
| `index.html local reference ...` | Renamed/removed `style.css`, `script.js`, `favicon.svg` |
| `Markdown link ...` | Broken relative link in README, AGENTS or docs |
| `node --check ...` | Syntax error in any `.js`, including the template copy |
| `JSON parses ...` | Malformed `state.json` |
| `skill template ... byte-identical` | Template edited separately from the root source |

The check script itself is dependency-free; it uses only Node built-ins.

## 2. Skill package check

```sh
node ~/.config/opencode/skills/skill-publish/scripts/check-skill.mjs skills/cyberdoom-retro-fps
```

Expected:

```text
OK cyberdoom-retro-fps — "CYBERDOOM Retro FPS", <files> files, <size> MB
```

It validates kebab-case directory name, frontmatter `name`/`description`/`version`, forbidden
directories, token/key/email patterns, and size limits. The template contains no secrets, accounts or
personal paths.

## 3. Template identity

```sh
for f in index.html style.css script.js; do
  cmp "skills/cyberdoom-retro-fps/assets/template/$f" "$f" && echo "$f identical"
done
```

Expected: three `identical` lines. `scripts/check.mjs` performs the same comparison as three checks.

## 4. Browser self-test

Serve the repo:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000/?selftest=1`. After ~1.5 s:

- Console: `CYBERDOOM SELF-TEST 17/17`.
- `<html data-selftest="17/17">`.
- No `CYBERDOOM SELF-TEST FAILURES` warning.

The 17 checks:

```text
Three.js r128 loaded
PointerLockControls API present
WebGL renderer online
Dungeon generated
Exit reachable from start
Start and exit are walkable
Start is collision free
Walls collide
Pathfinding resolves start to exit
Two weapons configured
Three enemy archetypes configured
Four pickup types configured
HUD elements mounted
Web Audio API available
Save sanitisation roundtrip
Save validator rejects malformed input
High score archive readable
```

This proves boot, WebGL, generation, pathfinding, basic data tables, HUD mounting, the audio API and
save validation. It does **not** prove pointer lock, audio output, touch input, rendering quality,
level transitions or victory.

## 5. Manual gameplay matrix

Run in a real browser (desktop and mobile emulation). Stop at the first failure.

| # | Check | Expected |
| --- | --- | --- |
| 1 | New campaign | Title → loading → sector 01 HUD; click requests pointer lock |
| 2 | Movement | WASD/arrows move and strafe; Shift sprints; no wall clipping |
| 3 | Jump | Space jumps; landing does not sink below the floor |
| 4 | Look | Mouse yaw/pitch; pitch stops at ±1.35 rad |
| 5 | Plasma | `1`, fire: tracer, flash, recoil, damage, hit sparks |
| 6 | Shotgun | `2`, fire: 9 pellets, spread, falloff, heavy shake |
| 7 | Weapon switch | `1`/`2`/`Q`/wheel all switch; HUD ammo label follows |
| 8 | Ammo | Empty magazine dry-fires; “OUT OF AMMO”; pickup refills |
| 9 | Enemy LOS | Break line of sight: enemy paths to last seen, then patrols |
| 10 | Alert spread | Shooting near idle enemies wakes them |
| 11 | Damage | Enemy projectile/melee lowers health; armour absorbs part |
| 12 | Face | Portrait changes at 75/50/25 HP; hurt/kill reactions |
| 13 | Death | 0 HP → fall → game over → retry (55 HP, ≥25 armour) |
| 14 | Pause | Esc/P freezes the game; resume re-locks |
| 15 | Portal | Kill all → portal green → prompt; +250 score |
| 16 | Enter portal | Clear screen shows kills/time/bonus; next sector loads |
| 17 | All three sectors | Sector 03 clear → victory with rank/accuracy/time |
| 18 | High score | Recorded on victory/death; persists after reload; top 5 shown |
| 19 | Export | Pause → Save Game State downloads `cyberdoom_save.json` |
| 20 | Import | Title → Load Game State restores run; invalid file is rejected |
| 21 | Continue | Reload mid-run → Continue restores sector/position/ammo/score |
| 22 | Settings | Sensitivity, volume, resolution, shake persist after reload |
| 23 | Mobile 390×844 | No horizontal overflow; touch pads usable; HUD not clipped |
| 24 | Touch look/move | Stick moves relative to look; drag look changes yaw/pitch |
| 25 | Audio | First click unlocks; both weapons, enemy, pickup, hurt, portal audible |

## 6. Save round-trip check

1. Start a campaign, move, fire, take damage, collect one pickup.
2. Pause, export `cyberdoom_save.json`.
3. Return to title, clear the site's localStorage (or use a private window), import the file.
4. Confirm sector, seed-derived layout, position, health, armour, ammo, score, kills, remaining
   enemies and untaken pickups.

Known limits: prop offsets are regenerated with `Math.random`; enemy patrol paths and alert timers
are not saved. The grid layout is deterministic from `seed`.

Malformed-input checks (manual or through `window.CyberDoom.applyRun`):

```js
sanitiseRun(null)              // null
sanitiseRun({ level: 99 })     // null
sanitiseRun({ level: 1.5 })    // null
sanitiseRun({ level: 0, seed: 0 }).seed  // 1 (documented clamp)
```

## 7. Deployment verification

```sh
for path in "" "style.css" "script.js" "favicon.svg" "docs/social-card.png" "state.json"; do
  printf '%-24s ' "$path"
  curl -sS -m 20 -o /dev/null -w '%{http_code}\n' "https://somphol.github.io/cyberdoom-retro-fps/$path"
done

shasum -a 256 script.js
curl -sS https://somphol.github.io/cyberdoom-retro-fps/script.js | shasum -a 256
```

Expected: all 200; hashes match. Open the live `?selftest=1` and confirm 17/17. See
[DEPLOYMENT](../../../docs/DEPLOYMENT.md) for rollback and cache behaviour.

## 8. What not to claim

- Do not claim Firefox/Safari support from a Chrome run.
- Do not claim offline support; the CDNs are required.
- Do not claim real-device mobile testing from CDP touch emulation.
- Do not claim audio output from the self-test; it only proves the API exists.
- Do not claim a save restores prop positions exactly.
- Do not report the static check count without running it.
