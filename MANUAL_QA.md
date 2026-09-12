# Manual QA before tagging a release

**Read this before every `v*` tag. It is not optional.**

The compose bar has now shipped broken three times — v0.8.32, v0.8.33 and
v0.8.34 — and every one of those releases had a green test suite, a clean
typecheck and a successful build. None of that catches this class of bug,
because none of it opens Gmail.

What each of those releases actually did to users:

| Version | Claimed | Actually |
|---|---|---|
| v0.8.33 | fixed the compose bar clipping | the guard excluded the exact case it was written for, so it never executed |
| v0.8.34 | fixed Send being hidden | still covered Send by 24px, and now covered the typing area by 16px too |
| v0.8.34 | — | also hid the bar entirely on inline replies, so many users silently had no feature |

Every one of those is a two-minute check in a browser.

---

## Before you start

```bash
npm run build
```

Then in Chrome: `chrome://extensions` → Developer mode on → **Load unpacked** →
select `dist/`. Disable the Web Store copy first so you are not testing two
versions at once.

Check `chrome://extensions` shows the version you expect. Reload the extension
AND hard-reload Gmail after every rebuild — Gmail caches content scripts
aggressively and you will otherwise test the old build and believe it passed.

---

## The checks

Tick all of them. If one fails, do not tag.

### 1. Inline reply — the common case
- [ ] Open a thread, click **Reply**. The bar appears above the compose card.
- [ ] The bar's left edge lines up with the compose card, not the avatar gutter.
- [ ] Type several lines. **No part of the bar covers the text you are typing.**
- [ ] Scroll down. **Send is fully visible and clickable.**
- [ ] Click **Discard**. The bar does not stay floating over the message body.

### 2. Maximised compose — where the pinning code runs
This path has the most logic and the least coverage. Do not skip it.
- [ ] Open a reply, click the full-screen / pop-out control.
- [ ] **Send is visible and clickable.**
- [ ] The bar covers neither the typing area nor Send.
- [ ] Toggle back out of full screen. Still true.

### 3. Floating "New Message" popup
- [ ] Click **Compose**. The popup's own title bar (minimise / pop-out / close)
      is reachable and not clipped behind Gmail's toolbar.
- [ ] Send is visible and clickable.

### 4. It still works
Placement is not the only thing that can break.
- [ ] Type a prompt, click **Generate**. A draft appears in the compose.
- [ ] The draft inserts into the right compose window.
- [ ] Intent chips appear on a reply and clicking one steers the draft.
- [ ] **Time it.** A draft should land in about 5 seconds. If Generate sits on
      "Generating..." for 30 and then tells you to check you're signed in, you
      are not signed out — something upstream died silently. v0.8.41 shipped
      exactly that: valid session, healthy API answering in 4.4s, and the bar
      showing a login error.

### 5. The draft is written from YOUR side
A draft that appears is not a draft that is correct, and this class of bug is
invisible unless you read what it wrote.
- [ ] Pick a thread where **you sent the most recent message** — a follow-up,
      an "any update?". Generate.
- [ ] The draft continues *your* position. It does not answer your own message
      as though it were the other party.

      v0.8.42 failed this on a live pricing negotiation: Pratik, the buyer,
      had asked "Can we do $15/user/month?" and Pranan drafted "Yes, we can
      offer $15/user/month" — committing to a price from the vendor's side.

- [ ] Read the whole draft. No sentence refers to a person who was never
      introduced ("They'll be able to dive deeper…").

### 6. Awkward states
- [ ] Two replies open in different threads at once — each bar belongs to its
      own compose, neither is orphaned.
- [ ] **Send a reply, then open another one in the same thread.** Exactly one
      bar. v0.8.41 stacked one more bar per cycle, because the bar outlived the
      compose it was built for — two Generate buttons, zero composes.
- [ ] Resize the browser window with a compose open. Nothing ends up on top of
      anything.
- [ ] A narrow window (~1100px). Still no overlap.

---

## Before you upload: does the build actually contain the fix?

Every check above tests a build on your machine. None of them tests that the
**zip you upload** is that build.

On 29 Jul, v0.8.36 was submitted and published while five versions of compose-bar
fixes sat unmerged on a branch. The store got a build with none of them, users
kept hitting bugs that were already fixed, and nothing in this document caught
it — because the fixes were never in the artifact being tested.

Build from `main`, in a clean clone, and confirm what came out:

```bash
git clone <repo> release-build && cd release-build
npm ci && npm run typecheck && npm test && npm run build
grep -o '"version"[^,]*' dist/manifest.json    # is this the version you mean?
(cd dist && zip -r ../pranan-companion-vX.Y.Z.zip .)
```

- [ ] `main` contains the fixes. Check the PRs are **merged**, not just open.
- [ ] The clone is fresh. Not your working tree, which may hold uncommitted work
      that makes a broken `main` look fine.
- [ ] `dist/manifest.json` shows the version you intend to publish.
- [ ] Grep the built bundle for one string from each fix in the release. If a fix
      is in the changelog and not in `dist/`, the release is a lie.
- [ ] After the store approves it, install the **store** copy and re-run check 4.
      Approval means it passed review, not that it works.

---

## The one rule

**Our UI may never sit on top of the text being written or the Send button.**

Priority when they conflict:

1. never cover the compose
2. never make Send unreachable
3. show the bar

An invisible bar costs the user a feature. A bar over Send costs them the
ability to send an email at all.

`src/lib/compose-layout.ts` encodes this as `placementObscuresCompose`, and
`positionComposeBar` enforces it. If you change placement, that helper is the
thing to keep honest — and it is still only arithmetic. It cannot tell you what
the page looks like. That is what this document is for.

## 0.8.61 candidate: editing, signature and context

- Edit a side-panel draft, Preview it, Insert it and Copy it. All three must use the revised text.
- Deny clipboard access. The panel must show a failure, never Copied.
- Generate for compose A, switch to B or a different Gmail tab before completion. No A draft, rewrite or contact context may appear in B. Insert must carry A's editor binding or fail with Copy available.
- Generate in a new Gmail compose with a logo/link signature, then regenerate. Preserve the same signature and quoted history without duplication.
- Use a long recipient name in a floating compose. The bar, input and buttons must fit the compose width. At maximized/short sizes, verify the compact Draft with Pranan fallback remains usable and Send is not obscured.
- Retry a skipped draft or an unavailable extension worker. Preserve the typed instructions. The popover must not disappear and falsely acknowledge a missing worker.
- LinkedIn: open Start a post with a messaging overlay present. The current ShareBox editor must get post tools, never a Draft comment bar. Actual feed comments must retain their own controls.

### Inline reply with other extensions (2026-09-10 screenshot regression)
- In Gmail reply and reply-all, with Voilà and HubSpot enabled, verify the collapsed Pranan row, readable prompt and reachable editor/Send controls at default and enlarged browser zoom.
- Open Reply options and suggestions. Check relationship correction and side-panel actions, wrapped suggestions, and Escape focus return. Select an intent and verify the correct reply editor and preserved signature.
- Resize/pop out/maximize/restore compose. When space is constrained, the existing compact fallback must remain usable and no Pranan controls may cover the editor or Send.
- Local `/qa/inline.html` passed desktop, 320/420 px compose and 390 px viewport checks. Installed candidate and browser zoom checks remain required before release.
