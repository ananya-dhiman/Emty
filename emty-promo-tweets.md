# Emty — Promo Tweets (Technical / Builder)

8 standalone posts. Each is under 280 characters (free X limit). Post them a day or two apart in the run-up to launch. Character counts noted in brackets.

---

**1 — Zero setup (bundling)**

Most "local AI" tools make you install Ollama, pull a model, and run a server before anything works. Emty bundles all of it inside the app. Download, open, done — the Ollama + Node sidecars boot automatically. No terminal, no setup on the user's side.

`[246 chars]`

---

**2 — Tauri over Electron**

Why Tauri instead of Electron for Emty? A privacy app running a local AI model shouldn't also burn hundreds of MB of RAM just to draw a window. Tauri uses the OS webview: smaller installer, lighter footprint, more headroom left for the model to actually run.

`[257 chars]`

---

**3 — Local-first data (SQLite)**

Where does your email data live in Emty? In a SQLite file on your own machine. Bodies, AI insights, scores, feedback — all local. The cloud DB only ever holds account settings and label config. Never email content. Your inbox stays yours.

`[238 chars]`

---

**4 — The core idea: routing by sensitivity**

Not every email deserves the cloud. Emty runs a classifier that flags finance, health, legal and PII mail as sensitive and routes it to a local Ollama model — fully offline. Normal mail can go to fast cloud AI. Privacy by routing, not by promise.

`[247 chars]`

---

**5 — The desktop widget**

Built a desktop widget for Emty: a small frameless, transparent panel pinned to the corner of your screen. Your top-priority emails stay visible without opening the app. Toggle it from the system tray. It reads the same local DB, so it's always in sync.

`[251 chars]`

---

**6 — Background sync, spaced out on purpose**

Emty syncs in the background every ~3 hours, not constantly. A lightweight timer checks the gap and only fires when it's actually due. Spacing it out avoids hammering the machine and gives the local model room to breathe. Away a week? A catch-up flow handles it.

`[262 chars]`

---

**7 — Quota recovery, no config**

A detail I like in Emty: if your free Groq cloud quota runs out, it auto-switches every remaining email to the local Ollama model for the rest of the day, then resets tomorrow. No errors, no settings to touch. Sensitive mail was staying local anyway.

`[249 chars]`

---

**8 — Being a good guest on the user's machine**

Running AI on someone's own laptop means being a good guest. Emty processes emails one at a time, with rate-limit buffers between batches and exponential backoff on failure — so it never overloads the machine or the local model. Slow is smooth.

`[247 chars]`

---

*Tip: #6 and #7 pair well as a mini back-to-back on "how it behaves when you're not looking." #1 and #2 work as a setup/architecture pair.*
