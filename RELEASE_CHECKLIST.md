# Pranan Extension · Pre-Publish QA Gate

Every release runs through this checklist BEFORE the version tag is
pushed. Skip any step and bugs slip into the Chrome Web Store.

This was written after the v0.4.0 architectural auth fix (2026-05-07).
The previous failure mode was: ship to CWS, find out via real users.
That reverses now.

---

## Stage 1 · Build verification (the 30-second gate)

Run from the extension repo root:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

All four must exit 0. If anything fails, do not proceed.

Expected:
- `typecheck`: zero errors
- `test`: all vitest suites pass
- `build`: `dist/` contains `manifest.json`, `popup.html`, `sidepanel.html`,
  background.js, content/{gmail,slack,linkedin,universal,pranan-app}.js
- Built `manifest.json` version matches `package.json` version (the CI
  release workflow enforces this; doesn't hurt to eyeball)

---

## Stage 2 · Local unpacked install (the daily loop)

In Chrome:

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top right) ON
3. **Disable** the CWS-installed Pranan extension (toggle off)
4. Click **Load unpacked** → select the `dist/` folder from your build
5. Pin the dev build to the toolbar so you can tell it apart visually

Verify the extension loaded without errors:
- Click the Pranan icon → popup opens, no error in DevTools console
- Open the side panel → loads, no error in console
- Click "service worker" link in chrome://extensions → DevTools opens
  on the SW; check console is clean

---

## Stage 3 · Smoke test (the 5-minute gate)

Run through every item. Each one is a real-world flow that has broken
before. Mark pass/fail.

### Auth boundary (the v0.4.0 architecture)

- [ ] Open Pranan popup. Today snapshot loads. **No "Connect Account"
      prompt.**
- [ ] Open Pranan side panel. Authed shell, no Connect prompt.
- [ ] Sign out of `app.pranan.ai` in another tab. Reload Gmail.
      Side panel correctly shows Connect prompt (auth boundary works).
- [ ] Sign back in to `app.pranan.ai`. Reload Gmail. Side panel
      auto-reauths, **no manual reconnect needed**. (This is the bug
      class v0.4.0 closes.)
- [ ] Open DevTools Network tab on app.pranan.ai. Confirm
      `/api/companion/auth` request includes the Supabase auth cookie
      (look for `Cookie: sb-...-auth-token=`).

### Gmail surface

- [ ] Open a thread with a tier-1 contact (Disha, Priya, etc).
      Side panel auto-loads relationship card.
- [ ] Click Reply. Pranan inline prompt bar appears in the compose box.
- [ ] Click the prompt bar → draft generates → voice score badge
      appears with score.
- [ ] Edit the draft. Voice score updates as you type (debounced).
- [ ] Click "Open in Gmail" / Send button works.
- [ ] Hover sender avatar → relationship card popup (if implemented).

### Slack surface

- [ ] Open a Slack DM with a known contact. Pranan icon appears next
      to the Send button.
- [ ] Click the Pranan icon → draft generates in your Slack tone.
- [ ] Channel-tone vs DM-tone: switch to a public channel, draft
      should feel less formal.

### LinkedIn surface

- [ ] Open a LinkedIn post. Click the comment box.
- [ ] **Pranan comment prompt bar appears EXACTLY ONCE.** (Regression
      check for the v0.3.9 dedup fix. If you see two bars stacked,
      something has regressed.)
- [ ] Type a draft, click "Improve in your voice" → text rewrites
      into your tone.
- [ ] Dismiss the prompt bar. Click into another comment box. Bar
      appears again on the new box (correctly).

### Console hygiene

- [ ] DevTools console for **popup**: zero errors
- [ ] DevTools console for **side panel**: zero errors
- [ ] DevTools console for **background service worker**: zero errors
- [ ] DevTools console for any **content script** (Gmail/Slack/
      LinkedIn): zero errors

### Network hygiene

- [ ] All `/api/companion/*` requests succeed (200 or expected error)
- [ ] No CORS errors in the Network tab
- [ ] No failed retries piling up (the fetchWithRetry helper handles
      transients but more than 3 retries on the same URL is a smell)

---

## Stage 4 · Server compatibility check

If the release touches anything in `src/lib/api-client.ts` or
authentication, confirm the server contract:

- [ ] `pranan-app` is deployed at the version that supports your
      changes. Check `https://app.pranan.ai/api/health` for last deploy.
- [ ] If you added a new endpoint, confirm it's live on prod by
      curling it (with a valid cookie or Bearer):
      ```bash
      curl -H "Cookie: sb-...=..." https://app.pranan.ai/api/companion/<new-endpoint>
      ```

---

## Stage 5 · Version sync + tag

Only after Stages 1-4 pass:

```bash
npm run version:patch   # or version:minor / version:major
git add -A
git commit -m "release: v$(node -p "require('./package.json').version")"
git push origin main
git tag v$(node -p "require('./package.json').version")
git push origin --tags
```

The Release workflow auto-builds, uploads to CWS, and creates a
GitHub Release with the zip artifact. CI green ≠ shipped — confirm:

- [ ] CI workflow run: success
- [ ] Release workflow run: success including the
      "Upload to Chrome Web Store" step
- [ ] GitHub Release created with the zip

---

## Stage 6 · CWS approval watch (passive)

Chrome Web Store review typically completes within hours to a day.
While waiting:

- [ ] Note the time you uploaded
- [ ] Watch the publisher dashboard at
      `https://chrome.google.com/webstore/devconsole`
- [ ] If review takes >48h, check the dashboard for status messages
      from Google (rejected items show a reason)

After approval:

- [ ] Force-update the extension on your own machine
      (`chrome://extensions` → reload Pranan)
- [ ] Re-run Stage 3 smoke test against the CWS-published build
      (catches anything the unpacked build masked, e.g., manifest
      differences)
- [ ] Watch /admin/observability for spikes in 4xx/5xx on
      /api/companion/* in the first 6 hours of rollout

---

## When in doubt — DO NOT TAG

If a smoke test is ambiguous, if a console error is unexplained, if a
network call looks weird: stop. Investigate. Fix. Re-run the gate.

A version that takes 2 extra hours to verify is cheaper than a CWS
release that breaks 1,000 users for 24 hours.

---

## Future improvements (tracked elsewhere)

- **Trusted-tester preview lane**: tag `v*-beta` → CWS unlisted
  preview → trusted testers → 24-48h burn-in → promote to listed.
- **Playwright real-browser CI**: Chromium with the extension
  pre-loaded, asserts side panel renders, no Connect prompt, etc.
  Catches DOM regressions on every PR.
- **Staging build target**: `npm run build:staging` builds against
  a Vercel preview URL or future `staging.pranan.ai` for risk-free
  testing of schema/auth/model changes before they hit production.

## Stage 7 — E2E smoke (automated, runs nightly + on push)

The `e2e-nightly.yml` workflow runs `npx playwright test` against a
fresh build on every push to `main` and at 03:00 UTC daily. It loads
the unpacked extension into a real Chromium and asserts:

- popup.html mounts without console errors
- sidepanel.html mounts without console errors

When it fails, traces and reports are uploaded as workflow artifacts.

To run it locally before pushing:

```bash
npm run test:e2e:install   # one-time: download Chromium for Playwright
npm run test:e2e           # builds + runs the smoke specs
```

Add new specs in `tests/e2e/`. Authenticated flows are deferred until
we have a test account + cookie injection helper.

## Stage 8 — E2E auth-flow tests (one-time setup)

The auth-flow specs in `tests/e2e/auth-flow.spec.ts` need a test
account on Pranan + GitHub secrets configured. Steps:

1. Sign up `e2e-test@insidea.com` (or similar dedicated test email)
   on `app.pranan.ai`. Complete onboarding. Connect Gmail.
2. In the extension repo settings → Secrets and variables → Actions:
   - `TEST_USER_EMAIL` → the test account email
   - `TEST_USER_PASSWORD` → the test account password
   - `PRANAN_APP_ORIGIN` → optional, defaults to `https://app.pranan.ai`
3. The next nightly run + every `main` push will execute the auth specs.

Specs that run when configured:
- Scenario A: authed popup with no Connect Account flash
- Scenario B: authed sidepanel with no Not Authenticated banner
- Scenario C: AUTH_RECOVERED message clears the banner

Specs skip silently when secrets aren't set, so unauth smoke still runs.
