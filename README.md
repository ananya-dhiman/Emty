# Emty

**Emty** is a local-first desktop app that connects to your Gmail, automatically ranks your emails by what actually matters, and generates AI insights — all while keeping your private data strictly on your machine.

---

## What Emty Does

Your inbox was not built to help you think. It was built to receive everything.

Emty changes that. It reads your Gmail in the background, classifies each message, scores it against your personal priorities, and surfaces only what needs your attention — organized into three simple tiers: action required, top priority, and everything else.

Around that ranking sit the parts that stop things slipping: it extracts deadlines from your email and [notifies you](#deadline-notifications) as they approach, lets you [pin and annotate](#tracking-an-email) anything you need to come back to, keeps [several Gmail accounts](#multiple-gmail-accounts) in one app, and puts your most urgent items in a [widget](#desktop-widget) on the corner of your screen.

It does this without sending your sensitive emails to any cloud service. Emails that contain financial, health, legal, or personal information are processed entirely offline, on your machine, using a locally running AI model.

---

## How It Is Different from Gmail's Priority Inbox

Gmail's Priority Inbox solves a real version of this problem, and solves it well. It ranks mail by the probability that you will interact with it, learned from signals like who you correspond with, which senders you reply to, and which terms appear in mail you act on. You can correct it with the importance markers, and those corrections feed back into your personal model.

So the difference is not that one system is intelligent and the other is not. It is **where the definition of "important" comes from**.

Gmail derives your priorities from your behavior — importance is *inferred* from your history. Emty asks you to state them — importance is *declared*, and you can open the declaration and edit it whenever your priorities change.

That distinction shows up in four practical places.

**1. Mail you have no history with.** An inferred model needs a signal to learn from. The first email from an organization you have never corresponded with — an application confirmation, an interview invitation, a fee notice — carries almost no behavioral history. A declared profile applies to it the moment it arrives, because you already said that `application` and `deadline` matter to you.

**2. Deadlines as a signal that strengthens over time.** Emty extracts dates from the email body and uses proximity to that date as a live score component, so a message's rank *rises* as its deadline approaches. Gmail does resurface mail you have not replied to, but that nudge is driven by how long the message has been sitting there, not by a date written inside it.

**3. Priorities you can edit directly.** Your keywords, preferred domains, and label ordering are inputs you can open and change. Reorder your labels during exam season and every existing score is re-ranked against the new order immediately — no retraining, no waiting for a model to notice that your habits shifted.

**4. Scores you can inspect.** Every email exposes its full breakdown: AI importance, label match, recency, and deadline boost. When something ranks wrongly, you can see which component caused it.

| | Gmail Priority Inbox | Emty |
|---|---|---|
| **Source of priority** | Inferred from your behavior and correspondence history | Declared by you up front, then refined by feedback |
| **New or unknown senders** | Little history available to learn from | Your stated keywords and domains apply immediately |
| **Deadline awareness** | A date inside the message is not a ranking signal | Extracted, and boosted further as the date approaches |
| **Changing your priorities** | Change your behavior and wait for the model to follow | Edit keywords or reorder labels; scores re-rank at once |
| **Score visibility** | A short reason is shown for a message being important | Itemized breakdown per email |
| **Sensitive email handling** | Processed on Google's servers like all other email | Detected by keyword classifier and routed to a local, offline AI model — never leaves your machine |
| **Data storage** | Email content stays on Google's servers | Email content, scores, and insights are stored only on your local machine |
| **AI model** | Google's internal models | Groq cloud (fast, for normal emails) + Ollama local (private, for sensitive emails) |

Neither approach is strictly better. Inference is effortless and handles the routine cases without you ever configuring anything. Declaration costs you about three minutes of setup, and it pays that back on exactly the mail you cannot afford to miss — the message from a sender you have no history with, carrying a date you will otherwise find out about too late.

---

## How Emty Learns: External and Internal Feedback

Emty uses two types of feedback signals to keep your inbox ranking accurate over time.

### External Feedback — You Tell It Directly

On any email card in the dashboard, you can give an explicit signal:

- **Boost** — this email was more important than Emty ranked it. Push it higher.
- **Suppress** — this email was not important. Stop surfacing similar ones.
- **Clear** — remove your signal and let the score stand on its own.

Every signal you send is recorded in your local feedback database and also written to a training dataset. That dataset captures the email subject, sender domain, time of day, thread size, and your verdict. This becomes a growing personal record of what you consider important — stored locally, never shared.

### Internal Feedback — The System Adjusts Automatically

Emty also updates its calibration without you doing anything:

- **Recency decay** — the longer an email sits without being acted on, the lower it scores. Emails do not stay at the top forever.
- **Deadline proximity** — if the AI extracts a deadline date from an email, the score increases as that date approaches. An email due tomorrow ranks higher than the same email due next week.
- **Label match drift** — as you reorder your label priorities in the Profile section, all existing scores are immediately re-ranked against your new order. No re-sync needed.
- **Groq rate limit recovery** — if your Groq daily quota runs out, Emty automatically switches to local Ollama processing and resets the next day without any action from you.

---

## Scoring: How Each Email Gets Its Rank

Every processed email receives a total score built from four components:

```
Total Score = Base Score + Dynamic Score

Base Score  = (0.6 x AI Importance) + (0.2 x Label Match)
Dynamic Score = (0.2 x Recency) + Deadline Boost
```

| Component | What it measures |
|---|---|
| AI Importance | How important the AI judged the email content to be, on a 0-1 scale |
| Label Match | How closely the email's labels align with your top-ranked priorities |
| Recency | How recently the email received a signal (sent, replied to, updated) |
| Deadline Boost | A score bonus applied when the AI detects a deadline within an upcoming window |

The dashboard splits your ranked emails into three active tiers:

- **Action Required** — emails where the AI detected an explicit task, response request, or deadline
- **Top Priority** — your next ten highest-scoring emails
- **Others** — everything else that scored above the low-priority threshold
- **Completed** — emails you have marked as done

---

## Privacy

Emty is built on the principle that your inbox is private.

- **Email content never goes to the cloud.** All email bodies, AI-extracted insights, scores, and feedback are written only to a SQLite database file on your local machine.
- **Sensitive emails never leave your device.** Emails flagged as sensitive — based on keywords related to finance, health, legal matters, credentials, or personal identifying information — are processed entirely offline using the bundled Ollama model. No data is sent to any external API for these emails.
- **You can see exactly what was flagged.** When an email is processed locally due to sensitivity, the dashboard displays a banner confirming it was processed on-device.
- **Cloud storage is minimal by design.** MongoDB is used only for your account preferences, Gmail connection settings, and label configuration — never for email content.
- **Groq API keys are encrypted before storage.** If you provide a Groq key, it is encrypted using AES-256 before being saved to your profile. The raw key is never logged or transmitted in plaintext.
- **OAuth tokens are short-lived.** Gmail OAuth state is stored in Redis with an expiry TTL. Gmail refresh tokens are encrypted at rest.

### Email Routing At a Glance

```
Incoming email
      |
      v
Keyword Classifier
      |
      +--- sensitive? (finance, health, legal, PII keywords detected)
      |         |
      |         v
      |    Ollama  (runs locally on your machine, fully offline)
      |
      +--- normal or routine + Groq key set?
      |         |
      |         v
      |    Groq Cloud API  (fast, external)
      |
      +--- fallback (no Groq key, or Groq quota exhausted)
                |
                v
          Ollama  (local fallback, always available)
```

---

## Tech Stack

### Desktop Shell

| Component | Technology | Version |
|---|---|---|
| Desktop runtime | Tauri | 2.x |
| Embedded backend | Node.js sidecar binary (bundled) | 18.x |
| Embedded AI | Ollama sidecar binary (bundled) | Latest stable |
| Installer format | NSIS | Windows |

### Frontend

| Component | Technology | Version |
|---|---|---|
| UI framework | React + TypeScript | 19.x |
| Build tool | Vite | 7.x |
| Authentication | Firebase SDK | 12.x |
| HTTP client | Axios | 1.x |
| Charts | Chart.js + react-chartjs-2 | 4.x |
| Icons | Lucide React | 1.x |
| Notifications | Tauri plugin-notification | 2.x |

### Backend (Node Sidecar)

| Component | Technology | Version |
|---|---|---|
| Server | Express + TypeScript | 5.x |
| Auth middleware | Firebase Admin SDK | 10.x |
| Gmail integration | googleapis | 169.x |
| Email parsing | html-to-text | 9.x |
| Logging | Pino | 10.x |

### Data Layer

| Store | Technology | Version | What it holds |
|---|---|---|---|
| SQLite | better-sqlite3 | 12.x | Email content, scores, insights, feedback, training data |
| MongoDB | Mongoose | 9.x | User profile, Gmail account config, label rules |
| Redis | redis | 5.x | OAuth state nonce with TTL |

### Packages Bundled with the App

No separate installation is needed for any of these. They are downloaded and bundled automatically when you install Emty.

| Package | Version | What it does |
|---|---|---|
| Node.js | 18.x | Runs the Express backend sidecar inside the app |
| Ollama | Latest stable | Runs the local AI model for sensitive email processing |
| better-sqlite3 | 12.x | Native SQLite bindings for local data storage |
| llama2 | Pulled on first run | Default local language model used by Ollama |

---

## AI Processing

Emty uses a dual AI routing system designed around speed and privacy.

### Email Classification

Every email passes through a keyword classifier before any AI model processes it. The classifier assigns one of three classes:

| Class | Description |
|---|---|
| **normal** | Standard work or personal email with no sensitive signals |
| **routine** | Newsletters, notifications, automated messages |
| **sensitive** | Contains keywords related to finance, health, legal, credentials, or personal information |

### What the AI Extracts

For each processed email, the AI produces:

- A one-line summary and detected intent (action required, information, follow-up, etc.)
- A checklist of action items you need to complete
- Extracted dates — deadlines, events, and follow-up reminders
- Important links found in the email body
- Suggested labels based on your existing label structure
- An importance score from 0 to 1

### Groq Fallback Handling

If your Groq daily token quota runs out, Emty automatically:
1. Records the time the quota was exhausted
2. Switches all remaining processing to local Ollama for that 24-hour window
3. Resets automatically the next day — no action needed from you

---

## Onboarding Guide

The onboarding flow is the single most important step to getting accurate results. The AI scoring and processing workers do not start until you complete onboarding. Take your time here — the effort pays off immediately.

### Step 1: Sign In

Sign in with your Google account. This creates your Emty profile and sets up your authentication session. Your profile is stored in the cloud (MongoDB) but your email data stays local.

### Step 2: Connect Gmail

Authorize Emty to access your Gmail inbox via OAuth. Emty requests only the minimum required Gmail scopes — it does not store your email password and cannot send email on your behalf.

After connecting, Emty begins an initial incremental sync of your inbox. This runs in the background.

### Step 3: Define Your Priorities (Most Important Step)

This is the core of onboarding. Emty asks you a structured set of questions to build your intent profile:

**Keywords to include** — words or phrases that signal a high-priority email for you. Examples: `invoice`, `deadline`, `contract`, `urgent`, `offer`.

**Preferred domains** — email domains you always want to see. Examples: `yourcompany.com`, `yourclient.com`.

**Keywords to exclude** — words that signal low-priority mail. Examples: `unsubscribe`, `newsletter`, `promo`.

**Blocked domains** — senders you always want deprioritized. Examples: `marketing@bigbrand.com`.

**Profile type** — tell Emty what kind of inbox you have: professional, student, or general. This adjusts the keyword set Emty uses to detect sensitive content.

**Tips for getting the best results:**
- Be specific with keywords. `invoice Q2` is a better signal than `email`.
- Add at least three preferred domains to give the label-matching system enough to work with.
- If you have existing Gmail labels you care about, mention them — Emty will try to map to them.

### Step 4: Review Your Label Priorities

After your intent profile is saved, Emty generates a ranked list of priority labels based on your existing Gmail labels and the keywords you provided. You will see this list and can drag items to reorder them.

**The label order matters.** Emails tagged with your top-ranked label score higher than emails tagged with a lower-ranked label. If `Needs Action` is ranked above `Finance`, an action-required email will outrank a finance email with the same AI importance score.

You can update this order at any time from the Profile section. Changes take effect on the next ranking refresh — no re-sync required.

### Step 5: Set Up AI (Optional but Recommended)

You can provide a Groq API key to enable fast cloud-based processing for your normal emails. Without it, all emails are processed by the local Ollama model, which is slower but fully offline.

- Groq is free to sign up for at groq.com and includes a generous daily quota
- Your key is encrypted before being saved — it is never stored in plaintext
- You can add, change, or remove your key at any time from the Profile section
- Sensitive emails are always processed locally regardless of whether you have a Groq key

### Step 6: Let the First Sync Complete

Once you complete onboarding, Emty triggers its first scoring and AI processing run. Depending on your inbox size, this may take a few minutes. A progress indicator is shown during this time.

After it completes:
- Your dashboard is populated with ranked email tiers
- The AI workers continue running in the background as new emails arrive
- The widget in the bottom-right corner of your screen shows your top items

### Calibrating Over Time

Emty gets more accurate as you use it. Here is how to keep it sharp:

- **Boost emails that should have ranked higher** — click the thumbs-up on any email card
- **Suppress emails that should not be surfaced** — click the thumbs-down
- **Reorder your label priorities** when your work focus shifts — do this from the Profile section
- **Update your intent profile keywords** as your projects change — Profile > Intent

Each boost or suppress signal is saved to your local training dataset. This is the data that will power future automated calibration of the scoring model.

---

## Tracking an Email

Ranking decides what you see first. Tracking is for the thing you have already seen, meant to deal with, and do not want to lose.

Any email card has a track toggle. Tracking pins it to a Tracked list that stays visible on the dashboard and in the widget until you untrack it or mark it completed.

You can also attach a **tracking note** to a pinned email — a short sticky note for the context that is not in the email itself. "Waiting on transcript before I reply." "Need manager approval first." The note lives on the pin, and toggling tracking off and on again preserves whatever note you had written.

Tracking is stored locally alongside the rest of your email data, and pins are scoped to the account they belong to.

---

## Deadline Notifications

Emty raises an email's score as its deadline approaches, but you do not have to be looking at the app for that to help you.

The desktop shell polls the local backend every 30 seconds and raises a native OS notification for any deadline that has become urgent. Notifications fall into three tiers:

| Tier | When it fires |
|---|---|
| **UPCOMING** | A detected deadline is within the next 48 hours |
| **DUE TODAY** | The deadline is within 24 hours and falls on today's date |
| **OVERDUE** | The deadline has passed and the email is not marked completed |

Two rules keep this from becoming noise:

- **Priority filtered.** Only emails with an importance score of 0.5 or higher can raise a notification. A newsletter that happens to mention a date will not interrupt you.
- **Fired once.** Every notification has a stable ID, and IDs that have already been shown are written to `notifications.json` in the app data directory. You get told once per deadline, and restarting the app does not replay old alerts.

Emails you have marked as completed stop generating notifications immediately.

You also get a notification when a background sync finishes, with the number of emails processed.

---

## Multiple Gmail Accounts

You can connect more than one Gmail account — a college address and a personal one, or work and personal — and switch between them from the Profile section without signing out.

**Accounts stay separate.** Each connected account keeps its own ranking, its own label priorities, its own sync state, and its own tracked list. Switching the active account switches the entire view: dashboard tiers, label config, sync progress, and pins all follow the account you are currently on.

This is deliberate. A merged feed would score your work mail and your college mail against a single priority list, and those are rarely the same list. What you get instead is one app instead of two browser tabs, with the ranking still tuned per inbox.

Your active account is remembered between sessions. Removing an account purges that account's local data along with it.

---

## Desktop Widget

The widget is a small, frameless, transparent panel anchored to the bottom-right corner of your screen.

- Shows your highest-priority email cards at a glance without opening the main window
- Toggles on and off from the system tray icon
- Clicking any card opens the full dashboard at that email
- Polls the local backend for updates while a sync is in progress

Three filter tabs control what it shows:

| Tab | What it shows |
|---|---|
| **All** | Your top-ranked emails, with the Tracked list appended below |
| **Urgent** | Only action-required emails, or anything scoring 0.6 and above |
| **Tracked** | Just your pinned emails and their notes |

Within each tab, cards are ordered by **closest deadline first**, then by score — so the widget answers "what is due soonest" rather than "what ranked highest overall".

The widget is a separate window from the main app. It reads from the same local database, so it is always in sync with what you see on the dashboard.

---

## Architecture

```
+----------------------------------------------------------+
|                    DESKTOP  (Tauri 2)                    |
|                                                          |
|   +--------------------+   +-------------------------+  |
|   |   React Frontend   |   |      Emty Widget        |  |
|   |   Dashboard        |   |   Frameless, 340x380    |  |
|   |   Onboarding       |   |   Bottom-right corner   |  |
|   |   Profile          |   |   Toggle via system tray|  |
|   +--------+-----------+   +-------------------------+  |
|            |   REST / HTTP (port 5000)                   |
|   +--------v-----------------------------------------+  |
|   |          Express Backend  (Node.js sidecar)       |  |
|   |                                                   |  |
|   |  Incremental Sync --> Scoring Worker              |  |
|   |                            |                      |  |
|   |             +--------------+---------------+      |  |
|   |             |                              |      |  |
|   |      normal / routine              sensitive      |  |
|   |             |                              |      |  |
|   |      [Groq Cloud API]         [Ollama - offline]  |  |
|   |       llama-3.3-70b            llama2 (bundled)   |  |
|   |                                                   |  |
|   +---------------------------------------------------+  |
|                                                          |
|   +----------+   +---------------+   +--------------+   |
|   |  SQLite  |   |   MongoDB     |   |    Redis     |   |
|   | (local)  |   |   (cloud)     |   |  (OAuth TTL) |   |
|   +----------+   +---------------+   +--------------+   |
+----------------------------------------------------------+
```

---

## Running Locally (Development)

```bash
# Install dependencies
npm --prefix backend install
npm --prefix frontend install

# Start the backend (port 5000)
npm --prefix backend run dev

# Start the frontend (port 5173)
npm --prefix frontend run dev

# Or run the full desktop app in one command
npm --prefix frontend run tauri:dev
```

Copy `.env.example` to `backend/.env` and fill in your values before starting.

Required environment variables:

```
MONGODB_URI
REDIS_URL
FIREBASE_PROJECT_ID
FIREBASE_PRIVATE_KEY
FIREBASE_CLIENT_EMAIL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
```

---

## Building for Production

```bash
npm --prefix backend run build
npm --prefix frontend run tauri:build
```

The installer is written to `frontend/src-tauri/target/release/bundle/nsis/`.

---

*Emty v1.0.0 — First Release*
