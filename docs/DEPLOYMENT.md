# Deployment

CYBERDOOM is published as a static GitHub Pages site from the repository root. There is no server,
build step, environment variable, database or API key.

- Repository: <https://github.com/somphol/cyberdoom-retro-fps>
- Live site: <https://somphol.github.io/cyberdoom-retro-fps/>
- Self-test URL: <https://somphol.github.io/cyberdoom-retro-fps/?selftest=1>
- Local master: `~/Projects/cyberdoom-retro-fps`

## 1. Pages settings

| Setting | Value |
| --- | --- |
| Source | **Deploy from a branch** |
| Branch | `main` |
| Folder | `/ (root)` |
| Custom domain | none (canonical host is `somphol.github.io`) |
| HTTPS | enforced by GitHub Pages |
| Jekyll | disabled by the empty `.nojekyll` file at the root |
| Build type | legacy branch build; no workflow file is required |

`main` is the only deploy branch. Every push to `main` that changes a published file triggers a new
Pages build. Documentation-only changes also trigger a build but do not alter the game.

## 2. What is published

Everything tracked in the repository is reachable under the site root, including:

| Path | Purpose |
| --- | --- |
| `/` | `index.html` — the game |
| `/style.css`, `/script.js` | App assets |
| `/favicon.svg` | Icon |
| `/docs/social-card.png` | Open Graph / Twitter card image |
| `/state.json`, `/STATE.md` | Historical build record |
| `/robots.txt`, `/sitemap.xml` | Crawler hints |
| `/screenshot*.png` | README screenshots; also reachable publicly |

The runtime also requests three external origins:

- `cdnjs.cloudflare.com` — Three.js r128
- `cdn.jsdelivr.net` — PointerLockControls r128
- `fonts.googleapis.com` / `fonts.gstatic.com` — three typefaces

Those are not controlled by this repository. If a CDN is blocked, the game cannot start; if fonts are
blocked, the CSS font stacks fall back.

## 3. Deploy

The only deploy action is a normal push to `main`:

```bash
cd ~/Projects/cyberdoom-retro-fps
node --check script.js
node scripts/check.mjs
git push origin main
```

Do not force-push. Do not rewrite `main` history to fix a deployment; revert instead. Credentials are
managed by the machine's configured Git credential helper and must never be committed, printed or
pasted into a command.

First-time setup, only if the repository is ever recreated:

1. Create the public repository.
2. Push `main`.
3. **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/ (root)`**.
4. Wait for the Pages build to finish.
5. Verify the URLs in §6.

## 4. Caching and propagation

GitHub Pages serves content through its own CDN and sets cache headers. A push does not update edge
caches instantly.

- A Pages build usually takes under a minute; a new deployment can take a few minutes to appear
  everywhere.
- Browsers may keep `style.css` or `script.js` after `index.html` changes. Hard reload
  (`Cmd+Shift+R` / `Ctrl+Shift+R`) or request the asset with a cache-busting query such as
  `script.js?v=2` when verifying.
- There is no `_headers`, service worker or custom cache policy in this project. Do not add one just
  to speed up a deploy.
- If the site shows an old build after several minutes, check **Settings → Pages** and the
  repository's Pages build status before changing code.

## 5. Rollback

Preferred, history-preserving rollback:

```bash
cd ~/Projects/cyberdoom-retro-fps
git log --oneline -5
git revert --no-edit <bad-commit>
git push origin main
```

This creates a new commit that undoes the bad one. Pages redeploys from the new tip. Do not
`git push --force` and do not reset `main` on the remote.

For a single bad asset, restore that file from the last known-good commit, re-run the checks, and
push normally:

```bash
git checkout <good-commit> -- script.js
node --check script.js
node scripts/check.mjs
git commit -m "revert: restore known-good script.js"
git push origin main
```

If Pages itself is misconfigured, fix **Settings → Pages**; do not delete the repository.

## 6. Verification URLs

After a deploy, check:

```bash
for path in "" "style.css" "script.js" "favicon.svg" "docs/social-card.png" "state.json"; do
  printf '%-24s ' "$path"
  curl -sS -m 20 -o /dev/null -w '%{http_code}\n' "https://somphol.github.io/cyberdoom-retro-fps/$path"
done
```

Expected: every line `200`.

Confirm the deployed script is the local one:

```bash
shasum -a 256 script.js
curl -sS https://somphol.github.io/cyberdoom-retro-fps/script.js | shasum -a 256
```

The two hashes must match. Repeat for `style.css` and `index.html` if the deploy is in doubt.

Browser verification:

1. <https://somphol.github.io/cyberdoom-retro-fps/> — title screen renders with fonts and the social
   card is not required for play.
2. <https://somphol.github.io/cyberdoom-retro-fps/?selftest=1> — after ~2 s, the console reads
   `CYBERDOOM SELF-TEST 17/17` and `<html>` has `data-selftest="17/17"`.
3. Start a campaign, fire both weapons, pause with `Esc`, export a save, return to title, import it.
4. `https://somphol.github.io/cyberdoom-retro-fps/robots.txt` and `/sitemap.xml` return 200.

## 7. Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Root URL 404 | Pages not enabled, wrong branch/folder, or first build still running | Check **Settings → Pages**; confirm `main` / `/ (root)`; wait for the build |
| Old game after push | CDN/browser cache or build not finished | Hard reload, check Pages build status, compare the `script.js` hash |
| Black page with “RENDER CORE OFFLINE” | Three.js CDN blocked or WebGL unavailable | Test the CDN URL, enable hardware acceleration, try another browser |
| Page loads but no pointer lock | Document not focused, embedded frame, headless browser, or permission denied | Click the viewport; open the page directly rather than in an iframe; use a normal browser |
| Touch controls missing | Coarse pointer not detected | Emulate a touch device or use a real touch screen; `(pointer: coarse)` drives the layout |
| “NO VALID AUTOSAVE FOUND” | Autosave cleared on clear/death, storage blocked, or run never started | Start a new campaign; check that localStorage is allowed |
| Save import rejected | Malformed JSON, wrong level/seed shape, or a hand-edited file | Re-export from the game; do not patch fields by hand |
| No sound | AudioContext not unlocked, muted, or volume 0 | Click once, press `M`, raise **Synth volume** in the pause menu |
| Fonts look different | Google Fonts blocked | Expected fallback: `Courier New`, `Avenir Next Condensed`, `Consolas` |
| Sitemap/robots stale | Static files updated but not recrawled | No action needed for gameplay |

## 8. Security and privacy

- No analytics, tracking pixels, cookies, accounts or remote APIs.
- Saves stay in `localStorage` or in the file the user downloads.
- The only network requests are the three CDN origins above.
- Never add tokens, credentials, `.env` files or personal data to the repository or to a save file.
- `state.json` contains build provenance only; it contains no credentials.

## 9. Release checklist

- [ ] `node --check script.js`
- [ ] `node scripts/check.mjs` → `OK <n> checks`
- [ ] `node ~/.config/opencode/skills/skill-publish/scripts/check-skill.mjs skills/cyberdoom-retro-fps`
- [ ] Skill template byte-identical to the three source files
- [ ] `git status` shows only intended changes
- [ ] One commit, normal push to `main`
- [ ] Live root, `script.js`, `style.css`, `favicon.svg` return 200
- [ ] Live `script.js` hash matches local
- [ ] `?selftest=1` reports 17/17
- [ ] `CHANGELOG.md` updated if the release changes behaviour
