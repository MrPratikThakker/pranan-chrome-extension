# Extension component preview

Run `npx vite --config qa/vite.config.ts`, then open http://127.0.0.1:5182/qa/.
Uses the actual DraftPanel and voice prompt components with sample data and a local insertion receipt. It does not load the extension, access accounts, send email, or prove Chrome Web Store parity. No microphone is started automatically. `qa/` is excluded from extension build inputs.
