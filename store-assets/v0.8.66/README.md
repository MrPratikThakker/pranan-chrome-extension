# Pranan Chrome Web Store assets, version 0.8.66

This folder contains the complete graphic set for the Chrome Web Store listing.

| File | Dimensions | Use |
| --- | ---: | --- |
| `01-reply-in-your-voice.png` | 1280×800 | Primary screenshot |
| `02-voice-input.png` | 1280×800 | Voice input screenshot |
| `03-relationship-context.png` | 1280×800 | Relationship context screenshot |
| `04-outcome-shortcuts.png` | 1280×800 | Outcome shortcuts screenshot |
| `05-improve-draft.png` | 1280×800 | Draft improvement screenshot |
| `promo-small-440x280.png` | 440×280 | Required small promo tile |
| `promo-marquee-1400x560.png` | 1400×560 | Optional marquee promo image |
| `source/pranan-brand-background.png` | 1984×793 | Generated source artwork |

The five screenshots are high-fidelity product illustrations based on the shipped 0.8.66 Gmail and side-panel UI. They use fictional data and supported states. The two promotional images combine generated abstract artwork with deterministic Pranan typography and product UI.

Regenerate every final PNG from the repository root with:

```bash
node scripts/generate-store-assets.mjs
```

The dashboard copy, screenshot order, captions, permission explanations, and publishing checklist are in `CHROME_WEB_STORE_LISTING.md`.
