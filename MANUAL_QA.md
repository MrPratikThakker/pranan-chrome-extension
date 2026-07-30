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

### 5. Awkward states
- [ ] Two replies open in different threads at once — each bar belongs to its
      own compose, neither is orphaned.
- [ ] Resize the browser window with a compose open. Nothing ends up on top of
      anything.
- [ ] A narrow window (~1100px). Still no overlap.

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
