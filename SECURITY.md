# Security Policy

## Supported versions

CYBERDOOM is a static, client-side web application. Security fixes are applied to the
latest commit on `main` and to the currently deployed GitHub Pages site.

| Version | Supported |
| --- | :---: |
| `main` / 1.x | ✅ |
| Older snapshots | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's
[private vulnerability reporting](https://github.com/somphol/cyberdoom-retro-fps/security/advisories/new).
If that is unavailable, contact the maintainer via the email address on the
[GitHub profile](https://github.com/somphol).

Please include:

- A description of the issue and its impact.
- Steps to reproduce, or a minimal proof of concept.
- The browser and operating system used.
- Any suggested mitigation, if you have one.

You can expect an acknowledgment within a few days. Valid reports will be investigated,
fixed on `main`, and credited in the release notes unless you prefer to remain anonymous.

## Scope

CYBERDOOM has no server, accounts, analytics, or telemetry. Any data the app remembers is
stored in the browser, and files are only downloaded when the user explicitly exports
them. Relevant areas include:

- cross-site scripting through imported files, saved state, or `localStorage` values;
- unsafe HTML rendering of titles, labels, or user-provided text;
- denial of service through pathological input or oversized save files;
- unintended data exposure from persisted progress or exports;
- supply-chain risk from third-party scripts loaded by the static site.

The following are generally out of scope:

- vulnerabilities in the browser itself;
- social engineering or physical access;
- reports that require a compromised device or malicious browser extension;
- missing security headers on GitHub Pages beyond what the platform allows.

## Security design

- The application is served as static HTML, CSS, and JavaScript. There is no backend,
  database, account system, or API key.
- User-controlled text is rendered as text rather than injected as HTML.
- Imported save files are parsed and validated before they replace local state.
- Progress and preferences stay in `localStorage` on the user's device.
- Third-party runtime libraries are loaded from their public CDNs and are documented in
  the repository. No analytics or tracking scripts are included.
