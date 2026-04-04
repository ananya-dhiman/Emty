# Engineering Notes

## Onboarding Gate For AI Pipeline

- `POST /api/emails/sync` must **not** start scoring/AI workers until `UserIntentProfile.onboardingCompleted === true`.
- Before onboarding completes, sync is staging-only (metadata + extracted features in `EmailMessage`).
- AI processing should begin from onboarding completion flow (`POST /api/intent/profile` with `onboardingCompleted: true`) or later sync calls after onboarding is complete.
- Do not remove this gate; it prevents premature routing decisions before priorities are confirmed or explicitly skipped by the user.

