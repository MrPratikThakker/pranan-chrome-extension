# Chrome Web Store listing: Pranan 0.8.68

Use this file as the source of truth for the Chrome Web Store dashboard. The copy describes the current extension behavior and matches manifest version `0.8.68`. Update the version here in the same release commit as `package.json` and `public/manifest.json`. The screenshots and promo art in `store-assets/v0.8.67/` still match the shipped interface.

## Product details

**Name**

> Pranan: AI Email Assistant in Your Voice

**Summary, 132 characters maximum**

> Your AI email twin. One-tap replies in your voice in Gmail, with relationship context, tone control, and smart nudges.

**Category**

> Productivity

**Language**

> English

## Detailed description

> Pranan is your digital twin for email. It writes context-aware replies in your voice, directly inside Gmail.
>
> The compact Pranan prompt appears when you open a Gmail compose window. Describe the outcome, speak your instruction, or leave the field blank to use the conversation. Press Enter and Pranan prepares a reply. If you have already started writing, the prompt changes to help you improve the draft.
>
> Open the Pranan side panel when you want more control:
>
> • See relationship context for the recipient before you reply
> • Start with a clear outcome: acknowledge, answer directly, or clarify
> • Dictate your instruction with built-in voice input
> • Match your voice or choose a warm, direct, or formal tone
> • Insert the generated draft into the open compose window
> • Access saved snippets, follow-ups, and briefings from one place
>
> Pranan also supports contextual drafting in Slack (channels, DMs and threads) and LinkedIn (messages and post comments).
>
> Privacy: Pranan sends a conversation to Pranan only when you use a Pranan action, plus, when you open a compose, the recipient's address (and for replies, the thread) to show relationship context and reply suggestions. Background grammar checks while you type, and learning your voice from LinkedIn comments you post, are off by default and run only if you turn them on. Voice input uses Chrome's built-in speech recognition (processed by Google) where available; otherwise the clip is transcribed by OpenAI for Pranan and not stored.
>
> Pranan is built for founders, executives, account managers, and teams that handle important relationships across many conversations.
>
> A Pranan account is required. Learn more at pranan.ai.

## Screenshot order and captions

Upload these five localized screenshots in this order. Each file is 1280×800 PNG and uses square, full-bleed edges.

1. `store-assets/v0.8.67/01-reply-in-your-voice.png`
   Caption: **Reply in your voice, right where you write**
2. `store-assets/v0.8.67/02-voice-input.png`
   Caption: **Speak the outcome and let Pranan draft the reply**
3. `store-assets/v0.8.67/03-relationship-context.png`
   Caption: **See relationship context before you respond**
4. `store-assets/v0.8.67/04-outcome-shortcuts.png`
   Caption: **Acknowledge, answer directly, or clarify in one click**
5. `store-assets/v0.8.67/05-improve-draft.png`
   Caption: **Improve an existing draft without losing your voice**

The screenshots are high-fidelity product illustrations based on the 0.8.67 interface. Recheck them against the build before each upload. They use fictional recipient information and demonstrate supported product states.

## Promotional images

**Small promo tile, required**

> `store-assets/v0.8.67/promo-small-440x280.png`

**Marquee promo image, optional**

> `store-assets/v0.8.67/promo-marquee-1400x560.png`

The promotional artwork uses Pranan's canonical logo, Instrument Serif, Inter, JetBrains Mono, twilight palette, and current product UI. It contains no third-party marks or user data.

## Store icon

> `public/icons/icon-128.png`

The existing icon is 128×128 PNG. Its visible artwork is contained inside the required transparent safe area.

## Single-purpose statement

> Pranan is a digital twin for email that helps users draft and improve context-aware messages in their own voice.

## Permission justifications

**storage**

> Keeps the user's Pranan sign-in in extension-only storage that web pages and content scripts cannot read, plus the user's settings (tone preference, privacy switches).

**sidePanel**

> Displays relationship context and drafting controls beside the current page.

**alarms**

> Refreshes the user's Pranan sign-in about every 25 minutes so a long-open tab does not get signed out.

**webNavigation**

> Gmail changes views without reloading the page. Pranan listens for these in-page navigations on mail.google.com only, to check that its Gmail script is still running.

**scripting**

> Used for one purpose: re-injecting Pranan's own bundled Gmail script into a mail.google.com tab when an in-page navigation left it unloaded. It never injects remote code or runs on other sites.

**Host permissions: mail.google.com, app.slack.com, www.linkedin.com**

> Lets Pranan read the active conversation and recipient when the user asks for a draft, rewrite or grammar check, look up the recipient's relationship context when a compose opens, and place the generated result into the compose field the user drafted from.

**Host permission: app.pranan.ai**

> Connects the extension to the user's Pranan account: sign-in handoff after the user clicks Connect, and Pranan's authenticated product services.

The extension does not request the `tabs` or `activeTab` permissions. It reads a tab's address only on the four sites above, which the host permissions already cover.

## Limited Use disclosure

> Pranan's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.
>
> Pranan uses message, thread, and recipient context to provide user-requested drafting and relationship features. Features that send what the user is typing in the background are off by default and require the user to turn them on. Pranan does not sell Google user data, use it for advertising, or use it to train general-purpose AI models.

## URLs

- Privacy policy: `https://pranan.ai/privacy` (section 7 covers the extension, including third-party voice processing)
- Product website: `https://pranan.ai`
- Support email: `privacy@pranan.ai`

## Publishing checklist

- [x] Manifest and package version are 0.8.68
- [x] Minimum Chrome version is 116 (side panel open support)
- [x] Store icon is present at 128×128
- [x] Five current screenshots are prepared at 1280×800
- [x] Small promo tile is prepared at 440×280
- [x] Marquee promo image is prepared at 1400×560
- [x] Product copy matches the current feature set
- [x] Permission justifications match the current manifest (no `tabs`, no `activeTab`)
- [ ] Privacy practices tab: declare "Personally identifiable information", "Personal communications" and "Website content"; the privacy policy discloses OpenAI and Google speech processing
- [x] Privacy policy URL is specified
- [ ] Upload the package when the current review lock clears
- [ ] Replace the listing copy and graphic assets in the dashboard
- [ ] Review the complete listing preview at desktop and mobile widths
- [ ] Submit the updated listing for review
- [ ] Verify the public item after approval and publishing

## Optional launch video

Create a 45 to 60 second YouTube video with this sequence:

1. Open an email and show the automatic Pranan compose prompt.
2. Press Enter to draft from the conversation.
3. Open the panel and show relationship context.
4. Choose an outcome and dictate a short instruction.
5. Insert the draft and show that the signature remains intact.

Use real product footage for the interaction. Keep any customer or recipient data fictional.
