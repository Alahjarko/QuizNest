# macOS Release Signing

GitHub Actions can build a DMG without Apple signing credentials, but a downloaded unsigned or ad-hoc signed DMG can be blocked by macOS Gatekeeper and shown as "damaged".

For tagged releases (`v*`), QuizNest requires a signed and notarized macOS artifact. Configure these repository secrets before pushing a release tag:

- `APPLE_CERTIFICATE`: base64 encoded `.p12` export of a **Developer ID Application** certificate.
- `APPLE_CERTIFICATE_PASSWORD`: password for the `.p12` export.
- `KEYCHAIN_PASSWORD`: temporary CI keychain password.
- `APPLE_ID`: Apple ID email used for notarization.
- `APPLE_PASSWORD`: Apple app-specific password.
- `APPLE_TEAM_ID`: Apple Developer Team ID.

After the secrets are present, the workflow imports the certificate, builds the Apple Silicon DMG, lets Tauri sign and notarize it, then validates the app and DMG with `codesign`, `spctl`, and `stapler`.

Non-tag branch builds may still create an unsigned DMG for testing, but those artifacts are not suitable for normal user installation after download.
