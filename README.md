# Pranan Companion (Chrome extension)

AI-powered relationship intelligence for Gmail, Slack, LinkedIn, and any web app. Draft replies in your voice, see relationship context, check tone, and get smart nudges — all inline.

## What it does

| Surface | What you get |
|---|---|
| **Side panel** (Cmd+Shift+P) | Relationship context for the current recipient, drafts, briefings, nudges |
| **Inline button** | One-click "Draft with Pranan" injected into Gmail / Slack / LinkedIn compose |
| **Selection menu** | Highlight text on any site → rewrite in your voice / grammar check |
| **Pre-meeting briefings** | Calendar event opens → auto-briefing in side panel |
| **Smart nudges** | Decay alerts, follow-up reminders, sentiment risks |

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+Shift+P` (Mac) / `Ctrl+Shift+P` | Toggle side panel |
| `Cmd+Shift+D` | Generate draft from compose context |
| `Cmd+Shift+R` | Rewrite selected text in your voice |
| `Cmd+Shift+G` | Grammar + tone check |

## Supported platforms

- Gmail (mail.google.com) — compose detection, recipient extraction, draft injection
- Slack (app.slack.com) — DM + channel compose
- LinkedIn (linkedin.com) — messaging
- **Universal** — selection-based rewrite/grammar on any https site
- Pranan app (app.pranan.ai) — auth bridge

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Side panel (React app)   ◄── 17 message types ──►  Service     │
│ - Auth, Briefing, Contact                          worker      │
│ - Draft, Rewrite, Grammar                          (background) │
│ - Nudges, Empty                                                 │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                  chrome.runtime.sendMessage
                               │
   ┌───────────────────────────┼───────────────────────────┐
   ▼                           ▼                           ▼
┌────────────┐           ┌────────────┐           ┌────────────┐
│ Gmail CS   │           │ Slack CS   │           │ Universal  │
│ - compose  │           │ - compose  │           │ - selection│
│ - inject   │           │ - inject   │           │ - rewrite  │
└────────────┘           └────────────┘           └────────────┘
                               │
                               ▼
                  ┌────────────────────────┐
                  │ app.pranan.ai          │
                  │ /api/companion/*       │
                  │ - auth, exchange       │
                  │ - context              │
                  │ - draft, grammar       │
                  │ - rewrite              │
                  └────────────────────────┘
```

## Build + load locally

```bash
git clone https://github.com/MrPratikThakker/pranan-chrome-extension.git
cd pranan-chrome-extension
npm install
npm run build
```

Then in Chrome:

1. `chrome://extensions`
2. Toggle "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `dist/` folder
5. Pin Pranan to your toolbar
6. Click the icon → "Sign in with Pranan"
7. Open Gmail → click Reply on any thread → see the Pranan button

## Develop with hot reload

```bash
npm run dev
```

Vite watches src/ and rebuilds dist/ on save. After each rebuild, click the reload icon next to Pranan in `chrome://extensions` (Chrome doesn't auto-reload extensions).

## Release process

1. Bump version in `manifest.json` and `package.json`
2. `npm run build`
3. Tag the commit: `git tag v0.x.0 && git push --tags`
4. CI (`.github/workflows/release.yml`) auto-builds + uploads to Chrome Web Store

## Backend dependencies

This extension is a thin client over the `/api/companion/*` endpoints in [pranan-app](https://github.com/MrPratikThakker/pranan-app/tree/main/src/app/api/companion). All inference happens server-side. The extension only handles auth, DOM injection, and UI.

## Privacy

The extension reads recipient names, email addresses, and selected text on supported sites — only when you actively invoke a Pranan action (sign in, click button, use shortcut). Nothing is sent to Pranan's servers passively.

Full privacy policy: https://pranan.ai/privacy (section 10 covers Companion data flow).

## Troubleshooting

- **Pranan button doesn't appear in Gmail compose:** Gmail DOM changes monthly. Open DevTools (F12), check Console for `[Pranan]` logs, file an issue with the page URL.
- **Sign-in stuck on the auth tab:** the popup polls for nonce in URL — make sure you completed the magic link flow and got redirected to `?nonce=...`. Check that app.pranan.ai cookies aren't blocked.
- **Side panel won't open:** check `chrome://extensions` → Pranan → Inspect views: service worker. Look for errors.

## License

Proprietary — INSIDEA, Inc. All rights reserved.

## Versioning

Following SemVer: MAJOR.MINOR.PATCH

- `v0.x` — pre-Chrome-Web-Store, internal builds
- `v1.0` — Chrome Web Store launch
- `v1.x` — feature additions
- `v2.0` — major rewrite or breaking change
