# Chrome Web Store listing: Pranan 0.8.66

Use this file as the source of truth for the Chrome Web Store dashboard. The copy and assets describe the current extension behavior and match manifest version `0.8.66`.

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

> Pranan helps you write context-aware replies in your voice, directly inside Gmail.
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
> Pranan also supports contextual drafting in Slack and LinkedIn.
>
> Pranan is built for founders, executives, account managers, and teams that handle important relationships across many conversations.
>
> A Pranan account is required. Learn more at pranan.ai.

## Screenshot order and captions

Upload these five localized screenshots in this order. Each file is 1280×800 PNG and uses square, full-bleed edges.

1. `store-assets/v0.8.66/01-reply-in-your-voice.png`
   Caption: **Reply in your voice, right where you write**
2. `store-assets/v0.8.66/02-voice-input.png`
   Caption: **Speak the outcome and let Pranan draft the reply**
3. `store-assets/v0.8.66/03-relationship-context.png`
   Caption: **See relationship context before you respond**
4. `store-assets/v0.8.66/04-outcome-shortcuts.png`
   Caption: **Acknowledge, answer directly, or clarify in one click**
5. `store-assets/v0.8.66/05-improve-draft.png`
   Caption: **Improve an existing draft without losing your voice**

The screenshots are high-fidelity product illustrations based on the shipped 0.8.66 interface. They use fictional recipient information and demonstrate supported product states.

## Promotional images

**Small promo tile, required**

> `store-assets/v0.8.66/promo-small-440x280.png`

**Marquee promo image, optional**

> `store-assets/v0.8.66/promo-marquee-1400x560.png`

The promotional artwork uses an AI-generated abstract background with deterministic Pranan branding and product UI layered on top. It contains no third-party marks or user data.

## Store icon

> `public/icons/icon-128.png`

The existing icon is 128×128 PNG. Its visible artwork is contained inside the required transparent safe area.

## Single-purpose statement

> Pranan is an AI communication assistant that helps users draft and improve context-aware messages in their own voice.

## Permission justifications

**activeTab**

> Lets Pranan act on the current supported communication tab after the user invokes the extension.

**storage**

> Stores authentication state and user preferences in the browser so the extension can maintain the signed-in experience and chosen settings.

**sidePanel**

> Displays relationship context and drafting controls beside the current page.

**tabs**

> Identifies the active supported tab so Pranan can route a user-requested draft to the correct compose window.

**alarms**

> Schedules background refresh and maintenance work required by the extension.

**webNavigation**

> Detects navigation within supported single-page applications so Pranan can refresh the active conversation context.

**scripting**

> Supports the extension's user interface and drafting actions on supported pages.

**Host permissions: mail.google.com, app.slack.com, linkedin.com**

> Lets Pranan read the active conversation and recipient context when the user drafts a message, and lets it place the generated result into the active compose field.

**Host permission: app.pranan.ai**

> Connects the extension to the user's Pranan account and Pranan's authenticated product services.

## Limited Use disclosure

> Pranan's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.
>
> Pranan uses message, thread, and recipient context to provide user-requested drafting and relationship features. Pranan does not sell Google user data, use it for advertising, or use it to train general-purpose AI models.

## URLs

- Privacy policy: `https://pranan.ai/privacy`
- Product website: `https://pranan.ai`
- Support email: `privacy@pranan.ai`

## Publishing checklist

- [x] Manifest and package version are 0.8.66
- [x] Store icon is present at 128×128
- [x] Five current screenshots are prepared at 1280×800
- [x] Small promo tile is prepared at 440×280
- [x] Marquee promo image is prepared at 1400×560
- [x] Product copy matches the current feature set
- [x] Permission justifications match the current manifest
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
