# Extension component preview

Run `npx vite --config qa/vite.config.ts`, then open http://127.0.0.1:5182/qa/.
Uses the actual DraftPanel and voice prompt components with sample data and a local insertion receipt. It does not load the extension, access accounts, send email, or prove Chrome Web Store parity. No microphone is started automatically. `qa/` is excluded from extension build inputs.

Inline reply regression: open `/qa/inline.html` on the same server. This renders the production `compactPromptBar` helper alongside illustrative Gmail, Voilà, HubSpot and assistant controls using sample data. Check full, 420 px and 320 px compose widths; options expansion, Escape focus restoration, retained instructions and exact intent selection. This fixture does not exercise Gmail injection, service-worker requests, installed-extension coexistence or real sending.
