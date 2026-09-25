# Pranan for Chrome

Pranan's Chrome extension. It drafts replies in your voice inside Gmail, Slack and LinkedIn, shows relationship context for the person you are writing to, and brings your follow-ups, briefings and snippets into a side panel.

## What it does

| Surface | What you get |
|---|---|
| **Gmail compose prompt** | A compact Pranan prompt in every Gmail compose window. Describe the outcome, speak it, or leave it blank to reply from the conversation. |
| **Inline bars and buttons** | Draft with Pranan in Slack (channels, DMs, threads) and LinkedIn (messages and post comments). |
| **Side panel** (`Cmd+Shift+P` / `Ctrl+Shift+P`) | Relationship context for the current recipient, drafts with tone control, rewrite and grammar checks on selected text, snippets, follow-up nudges, decay alerts and meeting briefings. |
| **Toolbar popup** | Today at a glance (drafts ready, threads awaiting you, voice score), quick actions, privacy switches, Disconnect. |

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+Shift+P` (Mac) / `Ctrl+Shift+P` | Toggle the side panel (Chrome command, can be changed in `chrome://extensions/shortcuts`) |
| `Cmd+Shift+D` / `Ctrl+Shift+D` | Draft from the compose context (only while the side panel has focus) |
| `Cmd+Shift+R` / `Ctrl+Shift+R` | Rewrite the selected text (only while the side panel has focus) |
| `Cmd+Shift+G` / `Ctrl+Shift+G` | Grammar and tone check on the selected text (only while the side panel has focus) |

## Supported sites

- Gmail (mail.google.com): compose detection, recipient extraction, draft insertion
- Slack (app.slack.com): channel, DM and thread compose
- LinkedIn (www.linkedin.com): messaging and post comments
- Pranan app (app.pranan.ai): sign-in handoff only

The extension does not run on any other site.

## Architecture

```
┌──────────────────────────────┐   runtime messages   ┌──────────────────────────────┐
│ Side panel + popup (React)   │ ◄──────────────────► │ Service worker (background)  │
│ Draft, Rewrite, Grammar,     │                      │ - the only API caller for    │
│ Nudges, Briefings, Snippets, │                      │   content scripts            │
│ Sessions, privacy switches   │                      │ - token refresh owner        │
└──────────────────────────────┘                      │ - sign-in handoff checks     │
                                                      └──────────────┬───────────────┘
            runtime messages (no tokens, no direct API calls)        │
   ┌──────────────────┬──────────────────┬──────────────────┐        │
   ▼                  ▼                  ▼                  ▼        ▼
┌──────────┐    ┌──────────┐     ┌────────────┐    ┌──────────────┐  ┌──────────────────────┐
│ Gmail CS │    │ Slack CS │     │ LinkedIn CS│    │ Pranan app CS│  │ app.pranan.ai        │
│ compose, │    │ compose, │     │ messages,  │    │ sign-in      │  │ /api/companion/*     │
│ insert   │    │ insert   │     │ comments   │    │ handoff only │  │ auth, context, draft,│
└──────────┘    └──────────┘     └────────────┘    └──────────────┘  │ grammar, rewrite,    │
                                                                      │ transcribe, nudges   │
                                                                      └──────────────────────┘
```

Tokens live in `chrome.storage.session` (trusted extension contexts only) with a persisted copy in the extension's own IndexedDB. Content scripts cannot read them and never call the API; they ask the service worker.

## Build and load locally

```bash
git clone https://github.com/MrPratikThakker/pranan-chrome-extension.git
cd pranan-chrome-extension
npm install
npm run build
```

Then in Chrome (116 or later):

1. `chrome://extensions`
2. Toggle "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `dist/` folder
5. Pin Pranan to your toolbar
6. Click the icon, then "Continue to Pranan" to sign in
7. Open Gmail, click Reply on any thread, and use the Pranan prompt

## Develop with hot reload

```bash
npm run dev
```

Vite watches `src/` and rebuilds `dist/` on save. After each rebuild, click the reload icon next to Pranan in `chrome://extensions` (Chrome does not auto-reload extensions).

## Release process

**Every release runs through the [pre-publish QA gate](./RELEASE_CHECKLIST.md) before tagging.**
Skip steps and bugs ship to the Chrome Web Store. The checklist exists because
we hit the same auth bug class three times.

Quick path once the checklist passes:

```bash
npm run prepublish:check       # typecheck + tests + build, all must be green
npm run version:patch          # or version:minor / version:major
git commit -am "release: v$(node -p "require('./package.json').version")"
git push origin main
git tag v$(node -p "require('./package.json').version")
git push origin --tags
```

The Release workflow builds, uploads to the Chrome Web Store, and creates
a GitHub Release with the zip artifact. Update the version reference in
[CHROME_WEB_STORE_LISTING.md](./CHROME_WEB_STORE_LISTING.md) in the same release.

### Local and staging testing (before you ever tag)

```bash
# Production build, points at app.pranan.ai (default)
npm run build
# load dist/ as unpacked in chrome://extensions

# Staging or Vercel preview build
VITE_API_HOST=https://pranan-app-git-feat-x.vercel.app npm run build:staging
# the name in chrome://extensions gets the host as a suffix
# host_permissions, externally_connectable and the sign-in handoff content
# script are patched for that host, so sign-in works there
# safe to install alongside the Chrome Web Store build
```

## Backend dependencies

This extension is a thin client over the `/api/companion/*` endpoints in [pranan-app](https://github.com/MrPratikThakker/pranan-app/tree/main/src/app/api/companion). All inference happens server-side. The extension handles sign-in, reading the conversation you are working on, inserting drafts, and UI.

## Privacy

What the extension sends to Pranan, and when:

- **When you use a Pranan action** (draft, rewrite, grammar check, open the side panel on a conversation): the active conversation, the recipient's name, email address or LinkedIn profile URL, and any text you selected or typed as an instruction.
- **When you open a Gmail compose or reply:** the recipient's address, to look up their relationship tier and context, and, for replies, the thread text, to suggest up to three reply outcomes. Nothing you type in the message body is sent for this.
- **Only if you turn it on** (toolbar popup, Privacy, both off by default):
  - *Check grammar while I type* sends the text you are writing in Gmail, Slack and LinkedIn after a short pause, and shows suggestions in the side panel.
  - *Learn my voice from LinkedIn comments* saves comments you have actually posted on LinkedIn to your voice profile.
- **Voice input:** when Chrome's built-in speech recognition is available, your speech is processed by Google's speech service under Google's terms. Otherwise the extension records a short clip (60 seconds maximum) and sends it to Pranan, which has it transcribed by OpenAI and returns the text. Pranan does not store the audio.

Stored in your browser: your Pranan sign-in tokens (trusted extension storage only, never readable by the pages or scripts on Gmail, Slack or LinkedIn) and your extension settings. Disconnect in the popup, or Sign out in the side panel, ends the session on the server and deletes the tokens. Signing out of app.pranan.ai does not sign out the extension.

Full privacy policy: https://pranan.ai/privacy (section 7, "Pranan for Chrome").

## Troubleshooting

- **Pranan prompt doesn't appear in Gmail compose:** Gmail's markup changes often. Open DevTools (F12), check the Console for `[Pranan]` logs, and file an issue with the page URL.
- **Sign-in doesn't connect the extension:** start sign-in from the extension (popup "Continue to Pranan" or side panel "Connect to Pranan") and finish within 15 minutes. The extension only accepts a sign-in it started. Check that app.pranan.ai cookies are not blocked.
- **Side panel won't open:** check `chrome://extensions`, Pranan, Inspect views: service worker, and look for errors.

## License

Proprietary. INSIDEA, Inc. All rights reserved.

## Versioning

Following SemVer: MAJOR.MINOR.PATCH

- `v0.x`: early releases, including the current Chrome Web Store builds
- `v1.0`: general availability
- `v1.x`: feature additions
- `v2.0`: major rewrite or breaking change
