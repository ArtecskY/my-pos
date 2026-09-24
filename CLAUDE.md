# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

Always respond in Thai (ภาษาไทย).

## Commands

```bash
npm install     # Backend deps (.npmrc build_from_source=true — needs build tools)
npm start       # node index.js on PORT (default 3000), serves client/dist
npm run build   # cd client && npm install && vite build → client/dist
npm run dev     # concurrently: backend :3000 + Vite dev server :5173 (proxies API to :3000)
```

No linting or test tooling is configured. The `test-*.js` / `patch-*.js` / `debug-*.js` files in the root are ad-hoc scratch scripts, not a test suite.

## Architecture

"Wisdom Order" — a Thai-language POS for selling digital game goods (game top-ups, Razer Gold, cards) with cost/profit tracking and automated top-up bots.

**Backend** (`index.js`, ~2800 lines):
- Express 5, express-session + bcryptjs auth, multer image upload → `uploads/` (5MB, images only)
- All routes are registered inside `initDB().then()` — the DB must be ready first. Only `/health`, `/restart`, `/admin/download-db` are outside it
- Three sequential job queues (array + running flag, one job at a time): Razer (`enqueueRazerOrder`), 24Pay (`enqueuePay24Item`), OOC (`enqueueOocItem`). On startup, items still in `pending` status are re-queued
- SSE: `GET /reservations/events` pushes reservation updates
- node-cron exports daily orders to Google Sheets at 05:00 (`sheets.js`)

**Bots** (each `require`d inside try/catch because Puppeteer is optional):
- `razer-bot.js` — Puppeteer, `RAZER_AUTO` (checkout URL) and `RAZER_KUROKO_UID` (UID-based); isolated BrowserContext per account
- `pay24-bot.js` — plain `fetch` to 24Pay agent API (`/agent/orders/create`, then poll every 5s up to 5 min)
- `ooc-bot.js` — Puppeteer login + pay flow (success-page selectors still TODO)
- `bank-bot.js` — KBank KBiz persistent session, statement screenshots

**Database** (`database.js`):
- `sql.js` (WASM SQLite, in-memory). Loads `pos.db` from `DATA_DIR` (or project root) on startup
- Every write must be followed by `save()`, which exports the whole DB to `pos.db`. `pos.db` is gitignored — it is the live data
- Schema changes: append `try { db.run('ALTER TABLE x ADD COLUMN y ...') } catch (e) { /* column exists */ }` to `initDB()`. There is no other migration system
- Queries use `db.exec(sql, params)` and read positional arrays: `r[0]?.values[0]`. New ids via `SELECT last_insert_rowid()`

**Main tables**: `products` (bundle, price_usd, cost, sort_order, pay24_data), `categories` (fill_type, shop_name, pay24_enabled, ooc_enabled), `orders` (transfer_amount/time, channel, tw, order_note, razer_*), `order_items` (credit_deducted, email_id_used, lot_id_used, cost_used, topup_breakdown, bundle_lot_info JSON, razer_jobs, pay24_*, ooc_*), `emails`, `email_topups` (FIFO cost), `email_types`, `product_bundles`, `product_lots`, `reservations` + `reservation_items`, `razer_account_types`, `pay24_config`, `ooc_config`, `ooc_topups`, `ooc_api_keys`, `settings`, `users`, `audit_log`

**Fill types** (`categories.fill_type`) decide how an order deducts stock/credit in `POST /orders`:
- `UID` / `OTHER_UID` — `products.stock`
- `ID_PASS` — `product_lots`
- `EMAIL` / `OTHER_EMAIL` — credits on `emails` (parsed from product name / `price_usd`)
- `RAZER` — manual, FIFO deduction from `email_topups`
- `RAZER_AUTO`, `RAZER_KUROKO_UID`, `24PAY_AUTO`, `OOC_AUTO` — skip stock validation; handed to the bot queues
- Custom types — defined in `email_types` with `behavior` EMAIL / RAZER / CREDITS (see `usesEmailCredits`, `getCustomEmailBehavior`)
- Bundles are split into per-component rows; component details live in `bundle_lot_info`

**Auth & roles**:
- `users.role` is `superadmin` or `admin`. The first registered user is superadmin; after that only a superadmin can register users
- `requireLogin` re-checks `active` and `session_version` on every request (bumping `session_version` forces logout) and syncs `role` into the session
- `requireSuperAdmin` guards writes to categories/products/emails/email-types/topups and all `/users/*`, `/audit-log`
- Record important actions with `logAudit(req.session.user, action, targetType, targetId, detail)`

**Frontend** (`client/`, React 19 + Vite 6 + Tailwind 4):
- `App.jsx` does hash routing (`#pos`, `#orders`, …). `ADMIN_PAGES` (`manage`, `pay24`, `users`) are hidden from non-superadmins
- Pages in `client/src/pages/`: POS, Manage, Emails, Orders, Dashboard, Bank, EmailSummary, Razer, Pay24, Pay24Bot, Users. `OOCBotPage.jsx` exists but is not wired into `App.jsx` yet
- The Vite dev proxy (`client/vite.config.js`) lists route prefixes explicitly. A new backend prefix must be added there or it will 404 in `npm run dev`
- `public/index.html` is the legacy vanilla UI. `client/dist` is served first

## Conventions

- UI text and API error messages are in Thai. Commit messages use `feat:` / `fix:` / `perf:` prefixes in English
- Timestamps: `new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' })`, never raw UTC
- Keep client polling infrequent: Railway bills network traffic

## Deployment (Railway)

- `railway.toml` builds with `npm install --omit=optional && npm run build`, so **Puppeteer is not installed on Railway**. Razer, OOC and bank bots only run on a local machine. 24Pay works in both places
- Env: `DATA_DIR=/data` (volume for `pos.db` and uploads), `NODE_ENV=production`, `SESSION_SECRET`, `PUPPETEER_SKIP_DOWNLOAD=true`. Healthcheck: `/health`
- Node.js 22.x is required
