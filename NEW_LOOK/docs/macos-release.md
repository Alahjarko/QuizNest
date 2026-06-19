# macOS Local Release

GitHub Actions does not build the macOS DMG for QuizNest anymore. The macOS package is built locally on a Mac.

Reason:

- Downloaded GitHub-built DMGs need Apple Developer ID signing, notarization, and stapling to avoid Gatekeeper showing the app as "damaged".
- CI signing adds fragile Apple certificate and notarization setup to a project that is mainly used locally.
- Local macOS packaging has already been reliable for QuizNest.

Use the local build script when a macOS installer is needed:

```bash
npm run build:dmg
```

The GitHub workflow now behaves as follows:

- `main` push: quick check only.
- `v*` tag push: build Windows and Android release assets.
- macOS DMG: build locally and distribute manually.

If a downloaded local DMG is blocked by Gatekeeper during personal testing, verify it first:

```bash
hdiutil verify release/QuizNest_*.dmg
```

For a personal, non-notarized app copied from a trusted local build, removing quarantine can help:

```bash
xattr -dr com.apple.quarantine /Applications/QuizNest.app
```
