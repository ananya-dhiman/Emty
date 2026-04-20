# Developer Guide

This is a Developer Guide designed for AI agents working in this codebase. It contains:

- **KEY AGENT RESPONSIBILITIES**: Important rules to follow when developing the application.
- **ARCHITECTURE**: application overview, components, layers, frameworks and libraries, key standards, code layout. 
- **DEVELOPMENT CAPABILITIES**: how to work with the application in a local test environment: interacting with servers, reading logs, running scripts, interactively accessing test data and debugging the app. 

The Developer Guide serves as an interface between the agent and the development environment. It aims to give the agent the knowledge, hands and eyes it needs to develop your application efficiently, autonomously and with a high degree of success. It also highlights any gaps in your architecture or missing development capabilities, helping the team identify opportunities for improvement. 

# KEY AGENT RESPONSIBILITIES

## Safety

- It is assumed that the application can run in a 'personal development environment', e.g. the user's local machine, or a namespaced cloud environment. 
- You must ensure that all actions you take will only affect the local development environment in a safe way. If in doubt, ask the user.
- Never take any action that affects a shared development environment without an explicit request from the user.
- Never access a production environment in any way.
- Ensure that any commands (e.g. aws cli) you run are configured to use the personal development environment.

## Continuous improvement

- You must help continuously improve this documentation. Correct any gaps or inaccuracies that you find. 
- Ensure that the document remains succinct. It will be read by all agents, so every token counts.

## Verification of changes

- You must verify every change that you make. 
- Don't guess or assume that a change is working unless it is confirmed by: 
  - An automated test, which must be written for new features, bugfixes
  - Or, for smaller changes or debugging: interactive verification using a Development Capability like log/database inspection or interactive browser debugging

## Use already-running servers

- For development environments that support hot reload of changes, use the existing development server/app instance if one is already running, instead of starting a new one or restarting. Use the "Application status" capability to determine if one is running before using "Run application".

# ARCHITECTURE

## Application Overview

### Purpose
Inbox-priority desktop/web app that connects Gmail, syncs messages, ranks priority, and generates structured AI insights. Main flow spans `backend/src/controllers/gmailAuthController.ts:store_credentials()`, `backend/src/services/incrementalSyncService.ts:sync()`, `backend/src/services/scoringWorkerService.ts:runScoringWorker()`, `backend/src/services/aiProcessingWorkerService.ts:runAiProcessingWorker()`, and `frontend/src/components/Dashboard.tsx`.

### Type
Hybrid app: React web frontend (`frontend/src`), Express backend API (`backend/src`), and Tauri desktop shell (`frontend/src-tauri`).

### Domain
Email productivity / inbox triage.

### Key Features
- Firebase token auth (`backend/src/middleware/authMiddleware.ts:verifyToken()`)
- Gmail OAuth connect (`backend/src/controllers/gmailAuthController.ts:initiateGoogleOAuth()`)
- Incremental sync with checkpoint locking (`backend/src/services/incrementalSyncService.ts`)
- Onboarding-gated scoring + AI workers (`backend/ENGINEERING_NOTES.md`, `backend/src/controllers/userIntentController.ts:upsertIntentProfile()`)
- Priority ranking and label-priority management (`backend/src/services/focusBoardService.ts:getPriorityRanking()`)
- Feedback telemetry + ranking metrics (`backend/src/controllers/userIntentController.ts:recordFeedback()`, `backend/src/controllers/metricsController.ts`)

## Architecture Shape

### Pattern
Modular monolith with controller/service/repository layers (`backend/src/controllers/*`, `backend/src/services/*`, `backend/src/db/repositories/*`).

### Deployment
Desktop: Tauri launches backend Node sidecar (`frontend/src-tauri/src/lib.rs`).
Web/dev: standalone backend + Vite frontend (`backend/package.json`, `frontend/package.json`).

### Communication
REST JSON APIs over HTTP (`backend/src/server.ts`).
OAuth redirect/callback for Google (`/api/auth/google/callback`).
[Not implemented yet] GraphQL/gRPC/WebSockets.

### Scalability
Persistent state split across MongoDB + SQLite + Redis. Some in-process state exists (`metadataCache` in `backend/src/controllers/emailController.ts`). No autoscaling/IaC orchestration files found.

## Tech Stack

### Primary Language(s)
TypeScript 5 (backend/frontend), Rust 2021 (Tauri), SQL (SQLite migrations in `backend/src/db/migrations.ts`).

### Runtime/Platform
Node.js runtime (backend + tooling), browser runtime (React), Tauri 2 desktop runtime.

### Package Manager
npm and cargo.

### Key Dependencies
Express 5, Mongoose 9, Firebase Admin, Google APIs, better-sqlite3, Redis client, React 19, Vite 7, Tauri 2.

## Frontend

### Framework
React 19 + TypeScript (`frontend/src/main.tsx`, `frontend/package.json`).

### Rendering
Client-rendered SPA via `createRoot` (`frontend/src/main.tsx`).

### Routing
Custom state-based routing in `frontend/src/App.tsx` (`route` state), no react-router imports found.

### Styling
CSS files under `frontend/src/*.css` and `frontend/src/styles/*.css`.

### State Management
[Component state only] (`useState/useEffect/useCallback` in `frontend/src/App.tsx`, `frontend/src/components/Dashboard.tsx`, `frontend/src/components/Onboarding.tsx`).

### Build Tool
Vite (`frontend/vite.config.ts`) plus Tauri build orchestration (`frontend/src-tauri/tauri.conf.json`).

### UI Components
Custom components in `frontend/src/components/*`; no external UI library found.

### API Communication
`axios` and `fetch` (`frontend/src/App.tsx`, `frontend/src/components/*`, `frontend/src/main.tsx`).

## Backend

### Framework
Express 5 (`backend/src/server.ts`), bootstrapped by `backend/src/index.ts`.

### API Style
REST routes: `backend/src/routes/authRoutes.ts`, `emailRoutes.ts`, `intentRoutes.ts`, `metricsRoutes.ts`.

### Middleware
CORS allowlist/local rules, JSON parsing, Firebase auth middleware, global error middleware (`backend/src/server.ts`, `backend/src/middleware/authMiddleware.ts`).

### Background Jobs
In-process async workers, not an external queue:
- `backend/src/services/scoringWorkerService.ts:runScoringWorker()`
- `backend/src/services/aiProcessingWorkerService.ts:runAiProcessingWorker()`

### File Handling
SQLite file storage (`backend/src/db/sqlite.ts`), plus Tauri bundle resources/sidecar binaries (`frontend/src-tauri/tauri.conf.json`).

## Authentication & Authorization

### Authentication Method
Firebase ID token bearer auth verified server-side (`backend/src/middleware/authMiddleware.ts:verifyToken()`).

### Auth Provider
Firebase Auth (frontend SDK + backend admin SDK) and Google OAuth for Gmail access (`frontend/src/utils/firebase.ts`, `backend/src/config/firebase.ts`, `backend/src/utils/createOAuth.ts`).

### Session Management
Client stores Firebase token in `localStorage` (`firebaseToken` key in `frontend/src/App.tsx`).
Backend validates token per request; OAuth state/session nonce stored in Redis with TTL.

### Multi-Factor Auth
[Not implemented yet]

### Password Policy
[Not applicable - no local password auth implementation in this codebase]

### Authorization Model
Ownership checks by authenticated Firebase UID across account-bound controllers (e.g., `gmailAuthController.ts`, `emailController.ts`, `syncProgressController.ts`).

### Roles & Permissions
[Not implemented yet]

### API Security
Bearer token auth, CORS restrictions. [Not implemented yet] explicit rate-limiting middleware.

### Token Management
Firebase token refresh handled in frontend (`onIdTokenChanged` in `frontend/src/App.tsx`).
Gmail OAuth tokens stored/refreshed in Mongo (`backend/src/model/GmailAccount.ts`, `backend/src/services/gmailAuth.ts:refreshAccessToken()`).

### SSO Integration
Google desktop OAuth login fallback in `backend/src/controllers/authController.ts:initiateDesktopOAuth()` and `desktopOAuthCallback()`.
## Data Layer

### Primary Database
Polyglot data layer:
- MongoDB for user/account/domain models (`backend/src/model/*`, Mongo connect in `backend/src/index.ts`)
- SQLite for local processing/index/feedback tables (`backend/src/db/migrations.ts`, `backend/src/db/repositories/*`)
- Redis for OAuth state (`backend/src/utils/redis.ts`)

### ORM/ODM
Mongoose for MongoDB (`backend/src/model/*`).
SQLite via repository pattern and better-sqlite3, no ORM (`backend/src/db/repositories/*`).

### Migrations
Forward SQLite migrations in code with `schema_version` table (`backend/src/db/migrations.ts:runMigrations()`).

### Caching
Redis (OAuth state) and in-memory metadata cache (`backend/src/controllers/emailController.ts`).

### Search
[Not implemented yet]

### Data Validation
Manual request validation in controllers + Mongoose schema constraints. [Not implemented yet] shared schema validation framework (e.g., Zod/Joi).

## Infrastructure & Deployment

### Hosting
Desktop packaging via Tauri sidecar (`frontend/src-tauri/tauri.conf.json`, `frontend/src-tauri/src/lib.rs`).
Web origin allowlist includes `https://emty-vert.vercel.app` in `backend/src/server.ts`.

### Containerization
[Not implemented yet]

### Infrastructure as Code
[Not implemented yet]

### CI/CD
[Not implemented yet - no `.github/workflows` or other CI pipeline definitions found]

### Monitoring
Internal ranking-feedback metrics endpoints (`backend/src/controllers/metricsController.ts`).
[Not implemented yet] external monitoring stack.

### Logging
Pino wrapper logger (`backend/src/utils/logger.ts`) and Tauri sidecar stdout/stderr forwarding (`frontend/src-tauri/src/lib.rs`).

### Secrets Management
Environment variables only; no dedicated secret-manager integration found.

## Development Patterns

### Code Style
TypeScript strict configs in backend/frontend tsconfig files and frontend ESLint config (`frontend/eslint.config.js`).

### Git Workflow
[Not implemented yet]

### Testing Strategy
[Not implemented yet - no real test runner configuration/scripts found]

### Error Handling
`try/catch` per controller + global Express error middleware (`backend/src/server.ts`).

### Security Patterns
Firebase token verification, OAuth state nonce in Redis, ownership checks, CORS restrictions.

### Documentation
`backend/ENGINEERING_NOTES.md`; local agent rules at `.agent/rules/code-guide.md` and `.agents/rules/orchastrate.md`.

### Configuration
Env-driven config in backend (`process.env`) and frontend (`import.meta.env`).

## Codebase Structure

```text
backend/
  src/index.ts                 # startup, env load, DB init
  src/server.ts                # express app and route mount
  src/routes/                  # auth/email/intent/metrics route wiring
  src/controllers/             # request handlers
  src/services/                # sync, scoring, AI, ranking, metrics
  src/model/                   # mongoose models
  src/db/sqlite.ts             # sqlite lifecycle
  src/db/migrations.ts         # sqlite schema migrations
  src/db/repositories/         # sqlite DAOs
  src/utils/                   # logger, redis, oauth helper

frontend/
  src/main.tsx                 # app bootstrap + backend health wait
  src/App.tsx                  # auth/session and route state
  src/components/              # dashboard/onboarding/etc.
  src/pages/                   # metrics dashboard
  src/utils/                   # API resolver + firebase setup
  src/styles/                  # feature css
  src-tauri/src/lib.rs         # tauri runtime + node sidecar spawn
  src-tauri/tauri.conf.json    # tauri build/runtime config
  scripts/download-node.mjs    # node sidecar downloader
```

Entry Points:
- `backend/src/index.ts`
- `frontend/src/main.tsx`
- `frontend/src-tauri/src/main.rs`

Configuration Files:
- `backend/package.json`, `backend/tsconfig.json`
- `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig*.json`
- `frontend/src-tauri/tauri.conf.json`, `frontend/src-tauri/Cargo.toml`

Generated Files:
- `backend/dist` (backend build output)
- `frontend/dist` (frontend build output)
- `frontend/src-tauri/binaries` (downloaded sidecar)
- standard `node_modules` and Tauri target outputs

Scripts:
- backend scripts in `backend/package.json`
- frontend/tauri scripts in `frontend/package.json`
- sidecar setup script in `frontend/scripts/download-node.mjs`

Documentation:
- `backend/ENGINEERING_NOTES.md`
- `frontend/README.md` (Vite template)

# DEVELOPMENT CAPABILITIES

** ENVIRONMENT SAFETY NOTE**: Commands in this section use `<YOUR_ENV>` as a placeholder for environment names. Replace this with your personal development environment name (e.g., your username or a dedicated dev environment). NEVER use shared environments like 'dev', 'staging', or 'production' without explicit permission.

## Setup & Initialization

### Using the Personal Development Environment
- Set a local marker first: `$env:APP_ENV="<YOUR_ENV>"`
- Never point `MONGODB_URI`, `REDIS_URL`, Firebase/Google credentials, or OAuth callback targets to shared/prod resources unless explicitly requested.

### Install dependencies
```bash
npm --prefix backend install && npm --prefix frontend install
cargo fetch --manifest-path frontend/src-tauri/Cargo.toml
```

### Start application
Web/dev (hot reload):
```bash
$env:APP_ENV="<YOUR_ENV>"; npm --prefix backend run dev
$env:APP_ENV="<YOUR_ENV>"; npm --prefix frontend run dev
```
Desktop dev:
```bash
$env:APP_ENV="<YOUR_ENV>"; npm --prefix frontend run tauri:dev
```
Verified ports from code/config:
- backend default `5000` (`backend/src/index.ts`, `frontend/src/utils/api.ts`)
- frontend dev `5173` (`frontend/src-tauri/tauri.conf.json`)

### Stop application
`Ctrl+C` in each running terminal (backend/frontend/tauri dev).

### Application status
```bash
Get-NetTCPConnection -State Listen -LocalPort 5000,5173
Get-Process node
Invoke-WebRequest http://localhost:5000/health
```

### Application deployment info
- API base URL resolution: `frontend/src/utils/api.ts` + Tauri IPC `get_backend_url` (`frontend/src-tauri/src/lib.rs`)
- Routes mounted in `backend/src/server.ts`

### Environment setup
Backend env vars observed in code:
- `MONGODB_URI`, `REDIS_URL`, `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_GMAIL_SCOPE`, `FRONTEND_URL`
- optional: `PORT`, `TAURI_PORT`, `LOCAL_DB_PATH`, `LOG_LEVEL`, `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_API_KEY`, `MAX_RETRIES`, `SYNC_LOCK_TIMEOUT`, `PRIORITY_ACTION_REQUIRED_COUNT`, `PRIORITY_TOP_COUNT`, `AI_LABEL_SUGGESTION_MIN_MATCHES`
Frontend env vars:
- `VITE_API_BASE_URL`
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`

### One-command setup
[Not implemented yet]

### Environment validation
[Behavior needs verification - no dedicated validation script found]

### Quick reset
SQLite local reset utility (destructive):
```bash
$env:APP_ENV="<YOUR_ENV>"; node backend/src/utils/resetdb.ts
```
Warning: deletes `local.db`, `local.db-wal`, `local.db-shm` in current working directory (`backend/src/utils/resetdb.ts`).
## Build & Development

### Build project
```bash
npm --prefix backend run build
npm --prefix frontend run build
```

### Clean build
[Not implemented yet]

### Build for different environments
[Not implemented yet]

### Watch mode
- `npm --prefix backend run dev` (ts-node-dev respawn)
- `npm --prefix frontend run dev` (Vite HMR)

### Bundle analysis
[Not implemented yet]

### Source maps
[Behavior needs verification]

## Code Quality & Validation

### Run linter
```bash
npm --prefix frontend run lint
```

### Run type checker
```bash
npm --prefix backend run build
npm --prefix frontend run build
```

### Format code
[Not implemented yet]

### Fix linting issues
[Not implemented yet]

### Pre-commit validation
[Not implemented yet]

### Security scan
[Not implemented yet]

### Check code style
Frontend ESLint config is in `frontend/eslint.config.js`.

### Detect unused code
[Not implemented yet]

## Testing

### Run all tests
[Not implemented yet - backend `test` is a placeholder fail script; no frontend test script]

### Run specific test
[Not implemented yet]

### Run unit tests
[Not implemented yet]

### Test in watch mode
[Not implemented yet]

### Test coverage report
[Not implemented yet]

### Run integration tests
[Not implemented yet]

### Run E2E tests
[Not implemented yet]

### Debug specific test
[Not implemented yet]

### Generate test
[Not implemented yet]

### Create test user
[Behavior needs verification - no test-user utility script found]

### Log in test user
[Behavior needs verification - standard flow is Firebase login token flow]

## Database Operations

### Run migrations
SQLite migrations run automatically at backend startup (`backend/src/db/sqlite.ts` -> `backend/src/db/migrations.ts`).

### Connect to database
Use your chosen Mongo/SQLite client with paths/URI from env and `backend/src/db/sqlite.ts` path rules.

### Reset database
```bash
$env:APP_ENV="<YOUR_ENV>"; node backend/src/utils/resetdb.ts
```

### Seed database
[Not implemented yet]

### Run arbitrary query
[Behavior needs verification - no DB query utility script found]

### View schema
- SQLite schema: `backend/src/db/migrations.ts`
- Mongo schemas: `backend/src/model/*.ts`

### Rollback migration
[Not implemented - forward-only migrations]

### Backup database
[Not implemented yet]

### Restore database
[Not implemented yet]

### Query performance analysis
[Not implemented yet]

## Debugging & Inspection

### View logs
Backend logs use pino wrapper (`backend/src/utils/logger.ts`). Tauri forwards sidecar stdout/stderr (`frontend/src-tauri/src/lib.rs`).

### Tail logs
[Behavior needs verification - no dedicated file-tail setup found]

### Interactively use the app
- Web: run backend + frontend dev servers and open `http://localhost:5173`
- Desktop: run `npm --prefix frontend run tauri:dev`
- MCP servers: none detected by MCP resource discovery in this environment.

### Search logs
[Behavior needs verification]

### Filter logs by level
Set `LOG_LEVEL=debug` (see `backend/src/utils/logger.ts`).

### Connect debugger
[Not implemented yet]

### Inspect running process
```bash
Get-Process node
Get-NetTCPConnection -State Listen -LocalPort 5000,5173
```

### Profile performance
[Not implemented yet]

### Trace requests
Follow route/controller/service path from `backend/src/server.ts` into `backend/src/routes/*` and `backend/src/controllers/*`.

## Monitoring

### Health check
```bash
Invoke-WebRequest http://localhost:5000/health
```

### View metrics
Endpoints in `backend/src/routes/metricsRoutes.ts` backed by `backend/src/controllers/metricsController.ts`.

### Check service status
Sync progress endpoint: `GET /api/emails/sync-progress?accountId=<ACCOUNT_ID>` (`backend/src/controllers/syncProgressController.ts`).

### Monitor dashboard
UI metrics page: `frontend/src/pages/MetricsDashboard.tsx`.

### View error rates
[Not implemented yet]

## Deployment & Release

### Build for production
```bash
npm --prefix backend run build
npm --prefix frontend run build
npm --prefix frontend run tauri:build
```

### Run production mode locally
```bash
npm --prefix backend run build
npm --prefix backend run start
npm --prefix frontend run build
npm --prefix frontend run preview
```

### View deployment status
[Not implemented yet]

### Rollback deployment
[Not implemented yet]

### Run smoke tests
[Not implemented yet]

### Generate release notes
[Not implemented yet]

## Further Documentation

### Project overview
- `backend/ENGINEERING_NOTES.md`
- `frontend/src/App.tsx`

### Available commands
Backend `package.json`:
- `build`: `tsc`
- `start`: `node dist/index.js`
- `dev`: `ts-node-dev --respawn src/index.ts`
- `test`: placeholder fail command
Frontend `package.json`:
- `dev`, `build`, `lint`, `preview`, `tauri:dev`, `tauri:build`, `setup:sidecar`

### Environment variables
See `Environment setup` above.

### API documentation
[Not implemented yet]

### Generate documentation
[Not implemented yet]

### View documentation locally
[Not implemented yet]

### Architecture overview
This document + source files under `backend/src` and `frontend/src`.

### Troubleshooting guide
[Not implemented yet]
## Utilities

### Install dependencies
```bash
npm --prefix backend install
npm --prefix frontend install
cargo fetch --manifest-path frontend/src-tauri/Cargo.toml
```

### Update dependencies
[Behavior needs verification - no scripted dependency update workflow in repo]

### Check outdated dependencies
[Not implemented yet]

### Dependency security audit
[Not implemented yet]

### Clean cache
[Not implemented yet]

### Generate component/module
[Not implemented yet]

### Find unused dependencies
[Not implemented yet]

### Validate dependencies
[Not implemented yet]

## API/Service Specific

### List endpoints
Auth routes: `backend/src/routes/authRoutes.ts`
Email routes: `backend/src/routes/emailRoutes.ts`
Intent routes: `backend/src/routes/intentRoutes.ts`
Metrics routes: `backend/src/routes/metricsRoutes.ts`

### Test endpoint
```bash
Invoke-WebRequest http://localhost:5000/health
```
Protected endpoints require `Authorization: Bearer <FIREBASE_ID_TOKEN>`.

### View API documentation
[Not implemented yet]

### Mock external services
[Not implemented yet]

### Validate request/response
[Not implemented yet]

### Load test endpoint
[Not implemented yet]

## Frontend Specific

### Build frontend
```bash
npm --prefix frontend run build
```

### Bundle size analysis
[Not implemented yet]

### Component explorer
[Not implemented yet]

### Run accessibility audit
[Not implemented yet]

### Lighthouse audit
[Not implemented yet]

### Browser testing
[Not implemented yet]

## Configuration & Environment

### List configuration
[Behavior needs verification - no config-dump command found]

### Switch environment
Use env vars for local runtime configuration.
```bash
$env:APP_ENV="<YOUR_ENV>"
```

### Validate configuration
[Not implemented yet]

### Diff configurations
[Not implemented yet]

### Encrypt secrets
[Not implemented yet]

### Export configuration
[Not implemented yet]

---
Built with https://github.com/martinpllu/agent-dev-guide v1.0.1
