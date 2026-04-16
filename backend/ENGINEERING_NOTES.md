# Engineering Notes

## Onboarding Gate For AI Pipeline

- `POST /api/emails/sync` must **not** start scoring/AI workers until `UserIntentProfile.onboardingCompleted === true`.
- Before onboarding completes, sync is staging-only (metadata + extracted features in `EmailMessage`).
- AI processing should begin from onboarding completion flow (`POST /api/intent/profile` with `onboardingCompleted: true`) or later sync calls after onboarding is complete.
- Do not remove this gate; it prevents premature routing decisions before priorities are confirmed or explicitly skipped by the user.

### Current schema structure (Cloud and local )
The overall all schema structure is devided into two parts local sql and cloud mongo db based 
Local only models
backend\src\db\repositories\accountLocalRepository.ts
backend\src\db\repositories\emailMessageRepository.ts
backend\src\db\repositories\feedbackRepository.ts
backend\src\db\repositories\insightRepository.ts
backend\src\db\repositories\labelCandidateRepository.ts
backend\src\db\repositories\labelVectorRepository.ts
backend\src\db\repositories\processedEmailLogRepository.ts
backend\src\db\repositories\syncCheckpointRepository.ts
backend\src\db\repositories\trainingDatasetRepository.ts
backend\src\db\repositories\userLocalRepository.ts

Cloud only models
backend\src\model
backend\src\model\GmailAccount.ts
backend\src\model\Label.ts
backend\src\model\LabelPriorityConfig.ts
backend\src\model\User.ts
backend\src\model\UserIntentProfile.ts