# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

Always respond in Thai (ภาษาไทย).

## Commands

```bash
npm install   # Install dependencies (builds sql.js from source via .npmrc)
npm start     # Start the server (node index.js) on port 3000
```

No linting or test tooling is configured.

## Architecture

This is a minimal Point-of-Sale (POS) system with a Thai-language UI.

**Backend** (`index.js`, `database.js`):
- Express 5 server with session-based authentication (bcryptjs + express-session)
- All routes are defined inside the `initDB().then()` callback — the DB must be ready before routes are registered
- `requireLogin` middleware guards mutating routes; `GET /products` is public

**Database** (`database.js`):
- Uses `sql.js` (WebAssembly SQLite running in-memory, not native SQLite)
- On startup: loads `pos.db` binary file if it exists, otherwise creates a fresh DB
- Every write operation must call `save()` immediately after, which exports the in-memory DB and writes it back to `pos.db`
- `pos.db` is gitignored — it is the live data file

**Tables**: `products` (id, name, price, stock), `orders` (id, total, created_at), `order_items` (id, order_id, product_id, quantity, price), `users` (id, username, password)

**Frontend** (`public/index.html`):
- Single vanilla JS/HTML file served as static content
- On load calls `GET /me`; if unauthenticated shows the auth screen, otherwise shows POS directly
- Auth screen has Login/Register tabs on the same card; Register auto-logs in after success
- CORS is also configured for `localhost:5173` (Vite), suggesting a separate frontend build may be planned

**Key API routes**:
- `GET /products` — public
- `POST/PUT/DELETE /products/:id` — requires login
- `POST /orders` — requires login; calculates total server-side by re-fetching product prices
- `POST /register`, `POST /login`, `POST /logout`, `GET /me`

## Notes

- Node.js 22.x is required (specified in `package.json` engines)
- `.npmrc` sets `build_from_source=true`, so `npm install` compiles native modules locally — ensure build tools are available
- The session secret is hardcoded (`'pos-secret-key'`); change this for any production use
