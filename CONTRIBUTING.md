# Contributing to CYBERDOOM

Thanks for taking the time to contribute. CYBERDOOM is a complete retro 3D first-person shooter with procedural art and synthesized audio.
Keeping the project static, fast, and dependency-light is part of the design.

## Ways to contribute

- Report a reproducible bug.
- Suggest a feature that fits the project's scope.
- Improve documentation, screenshots, or examples.
- Fix an accessibility or responsive-layout issue.
- Improve performance or reduce visual and runtime cost.

For security issues, do **not** open a public issue. Follow [SECURITY.md](SECURITY.md).

## Before you start

- Check the [issue tracker](https://github.com/somphol/cyberdoom-retro-fps/issues) for existing
  reports and discussions.
- For a substantial change, open an issue first so we can agree on the approach.
- Keep pull requests focused. One logical change per pull request is easiest to review.

## Development workflow

There is nothing to install. Clone the repository and open the app:

```bash
git clone https://github.com/somphol/cyberdoom-retro-fps.git
cd cyberdoom-retro-fps
open index.html
```

Or serve the folder locally, which is closer to the deployed site:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

The app is plain HTML, CSS, and JavaScript, so a reload is usually the only build step.

The first load needs an internet connection because Three.js and other runtime libraries are loaded from public CDNs.

## Project constraints

Please preserve these properties:

1. **Static hosting.** The project must keep working from GitHub Pages without a build
   server or application backend.
2. **No tracking.** Do not add analytics, advertising, fingerprinting, or third-party
   telemetry.
3. **Local-first data.** User progress and preferences belong in the browser unless the
   user explicitly exports them.
4. **Accessibility.** Keep keyboard paths, focus styles, labels, and live regions intact.
5. **Responsive design.** Check both desktop and mobile layouts, including narrow phones.
6. **Graceful degradation.** The app should explain what is unavailable when WebGL, audio,
   storage, or another browser feature is missing.

## Keeping the bundle small

Prefer plain HTML, CSS, and JavaScript. If a new library is unavoidable, explain why in the pull request and document it in the README and third-party notices.

## Testing

Before opening a pull request:

- Open the live demo or run the app from a local server.
- Check the browser console for errors.
- Test in current Chrome, Safari, Firefox, and Edge where possible.
- Check desktop, tablet, and phone widths.
- Exercise the main flow end to end, including reload and persistence.
- Re-check any import or export path you touched.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat: add a new scene preset
fix: keep the timer running after a reload
docs: clarify the controls table
perf: reduce draw calls in the background
chore: update repository metadata
```

## Pull request checklist

- [ ] The change stays within the static, no-backend architecture.
- [ ] No new runtime dependency was added without discussion.
- [ ] The app runs without console errors.
- [ ] Desktop and mobile layouts were checked.
- [ ] Keyboard navigation and focus states still work.
- [ ] Persistence and import/export still behave correctly.
- [ ] Documentation and screenshots are updated when behaviour changes.
- [ ] The pull request description explains the problem and the chosen solution.

## Review process

A maintainer will review as soon as possible. Expect questions about scope,
accessibility, performance, and whether a feature belongs in the core app or a fork.
Small, well-tested changes usually land quickly.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
