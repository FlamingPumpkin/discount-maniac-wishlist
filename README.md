# Discount Maniac Wishlist

A Terminus app for managing to-do, shopping, and wishlist items, paired with a background agent for price monitoring.

## Project layout

- `app/` — app UI, item data, and collection configuration.
- `agent/` — agent instructions, schedule, and price watches.

## App development

Requires Node.js 24+.

```sh
cd app
npm install
npm run typecheck
npm run build
```

The app uses the published `@terminus-ai/app-sdk` browser package. The Terminus CLI 0.0.1 currently expects `@terminus-ai/sdk@~0.0.1` to build apps; that compatible package is not yet available from npm. Until Terminus publishes it (or updates the CLI to support the published browser SDK), `terminus dev` and `terminus push --dry-run` cannot validate this app.

The app starts with an empty list. Keep any personal seed data in `app/src/seed.local.ts`; it is ignored by Git. Use the app's import/export controls to move data between devices.

The **Check Terminus SDK availability** GitHub Actions workflow checks the required npm version range daily and can also be started manually. When a matching version appears, it opens a single GitHub issue as an alert.

To push either component, first sign in with `terminus login`, then register a new creation with `terminus create <name> .` or link an existing one with `terminus link <name>`. Signing in alone does not register or link a project.

The recovered product prices are starting data, not verified live prices. Confirm offers and target prices before relying on alerts.
