# Secrets — EAS builds & store submission

Values Isaiah supplies once the Apple Developer Program enrollment (DUNS)
lands. None of these are committed — add each one with:

```bash
cd mobile
npx eas secret:create --scope project --name <NAME> --value <value>
```

(`eas secret:create` stores them on EAS servers, scoped to this project.
Interactive `eas build` runs will also prompt for the Apple login directly —
the secrets below matter most for `eas submit` and any future CI.)

| Name                              | What it is                                                        | Where it comes from                                                                       |
| --------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `APPLE_ID`                        | Apple ID email for the developer account                          | The email used for the Apple Developer Program enrollment                                  |
| `APPLE_TEAM_ID`                   | 10-character Apple Team ID                                        | developer.apple.com → Membership (visible after enrollment completes)                      |
| `APPLE_APP_SPECIFIC_PASSWORD`     | App-specific password for `eas submit --platform ios`             | appleid.apple.com → Sign-In and Security → App-Specific Passwords                          |
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | Path to the Google service-account JSON key for Play Console      | Google Cloud console → service account with "Release manager" access on the Play app       |

Post-enrollment checklist (in order):

1. `npx eas login` (Expo account) — then `npx eas build:configure` to link the
   EAS project (commit the `extra.eas.projectId` it writes into
   `mobile/app.json`).
2. Add the secrets above via `eas secret:create`.
3. `npx eas build --platform ios --profile development` — first run registers
   Isaiah's iPhone UDID and lets EAS create/manage the signing certificate +
   provisioning profile on the new team.
4. Install the dev IPA from the QR/URL EAS prints.

Full command reference: `mobile/README.md` → "Building with EAS".
