# hadoku-aggregator

Dual-output npm package: React UI components + Hono API handler for OSS issue intelligence.
Published as `@wolffm/hadoku-aggregator` to GitHub Packages.

## Quick Reference

- Build: `pnpm build` (runs build:ui + build:api)
- Test: `pnpm test` (vitest, api tests only)
- E2E: `npx playwright test` (against production https://hadoku.me/aggregator)
- Lint: `pnpm lint:fix` (ESLint + Prettier, also runs in pre-commit hook)
- Dev: `pnpm dev` (Vite dev server, loads index.html)

## Architecture

- `src/` — React UI library. Entry: `src/entry.tsx` exports `mount(el)` / `unmount(el)`
- `api/` — Hono API handler. Entry: `api/index.ts` exports `createOSSHandler()`
- `api/recon/` — Scoring engine, KV reader/writer, dossier compiler (18 modules)
- Vite builds `src/` → `dist/index.js`; tsup builds `api/` → `dist/api/index.js`

## Colors

All colors come from `@wolffm/themes`. Read `node_modules/@wolffm/themes/THEME_USAGE_GUIDE.md` before writing styles. This repo styles with plain CSS `var(--color-*)` in `src/styles/index.css` (no Tailwind color classes) and imports the tokens via `import '@wolffm/themes/style.css'` in `src/entry.tsx`.

- **A token names a semantic role, not a hue.** Light/dark is automatic — never branch on theme mode or `[data-theme]`.
- `<f>` ∈ `primary | success | warning | danger | neutral`. Every family has exactly six tokens: `--color-<f>`, `-dark`, `-bg`, `-hover`, `--color-on-<f>`, `--color-on-<f>-bg`. If a name isn't in that shape, it doesn't exist (v3 removed `-light`/`-lighter`/`-darker`/`--color-muted-bg`).
- **Filled button** → `background: var(--color-<f>)` + `color: var(--color-on-<f>)`. **Tint badge** → `background: var(--color-<f>-bg)` + `color: var(--color-on-<f>-bg)` (NOT `var(--color-<f>)` as text — that fails AA in most themes). **Body text** → `var(--color-text)`. **Card** → `var(--color-bg-card)`. **Border** → `var(--color-border)`.
- **Never** `var(--color-x, #hex)` fallbacks (they hide broken tokens) or hex / `white` / `var(--color-bg)` literals as text on a filled family background.
- `entry.tsx` must import `style.css` **unlayered** — a `layer(...)` import makes every color resolve to nothing.
- Verify with `pnpm run lint:css` (runs `check-usage` from the package over `./src`).

## Data Flow

```
hadoku-scrape → Cloudflare KV (recon:{slug})
  → this repo reads + scores
  → KV (recon:{slug}:health, :scored-issues, :dossier)
  → API serves to vibedispatch
```

## Versioning

Pre-commit hook auto-bumps patch version on code changes (rollover at .20).
Publish workflow double-checks registry and bumps if needed. Never manually edit version.

## This repo does NOT

- Scrape external APIs (see hadoku-scrape — `../hadoku-scrape/`)
- Orchestrate fork/assign/review workflows (see vibedispatch — `../vibedispatch/`)
- Have filesystem access at runtime — all data via Cloudflare KV
- Use a database — KV is the only persistence layer

## Cross-Repo Contracts

- Publishes: `@wolffm/hadoku-aggregator` package (UI + API exports)
- Dispatches: `packages_updated` event to `WolffM/hadoku_site` on publish
- Consumes: `@wolffm/task-ui-components`, `@wolffm/themes` (peer deps)
- Reads KV keys written by hadoku-scrape (`recon:{slug}` consolidated format)
- Triggers hadoku-scrape via `POST {SCRAPER_API_URL}/api/v1/oss-recon/scrape`

## KV Key Patterns

- `recon:{slug}` — scraper-written consolidated data (issues, PRs, meta, comments)
- `recon:{slug}:health` — aggregator-computed repo health scores
- `recon:{slug}:scored-issues` — CVS-scored issues
- `recon:{slug}:dossier` — compiled markdown dossier
- `recon:{slug}:claims` — claim tracking (vibedispatch reports claims here)

## Environment (Cloudflare Worker)

- `CACHE_KV`: KV namespace binding (required)
- `SCRAPER_API_URL` + `SCRAPER_USER_KEY`: for triggering scraper (required)
- `GITHUB_TOKEN`, `PHABRICATOR_TOKEN`: legacy marking (optional)

## Auth & secrets (hadoku ecosystem)

- **Browser fetches** must hit `hadoku.me/{prefix}/*` via edge-router — NEVER `*.hadoku.me` direct subdomains. The `hadoku_session` cookie (`Domain=.hadoku.me`, 30d sliding) is set on `/auth` and resolved server-side by edge-router into `X-User-Key` for the backend.
- **Secrets**: vault-broker model, NO `.env` files. Local dev fetches via `.devvault.json` + `node ../hadoku_site/scripts/secrets/dev-vault.mjs -- <cmd>`. If `pnpm dev` fails, run `node ../hadoku_site/scripts/secrets/dev-vault.mjs --check` for diagnostics. **Tutorial: `../hadoku_site/docs/child-apps/USING_VAULT.md`**. Operational reference: `../hadoku_site/docs/operations/SECRETS.md`.
- **Auth model**: 1:1 named user-keys. `/auth` accepts key + name; whoami returns the name. Admin endpoints `GET/POST/DELETE /session/admin/keys` manage the registry. See `../hadoku_site/docs/planning/next-work.md`.

## Vault — what your service-tier key can and can't do

This repo's vault key lives in `.devvault.local.json` at the repo root (gitignored, mode 0600). `dev-vault.mjs` reads it automatically. Per-key ACL is enforced as of 2026-05-04.

CAN do (no operator needed):

- `GET /api/secrets/status` — sealed/unlocked check
- `GET /api/secrets/get/:key` — fetch a value declared in this repo's `.devvault.json`
  (other repos' secrets return 403 — your key is scoped to THIS repo)
- `GET /api/secrets/acl/me` — see what your key is granted
- Verify with: `node ../hadoku_site/scripts/secrets/dev-vault.mjs --check`

CANNOT do (returns `403` — by design):

- Read secrets NOT in this repo's `.devvault.json`
- `POST /api/secrets/admin/set-many` — adding/changing secrets
- `POST /api/secrets/admin/lock` — sealing the vault
- `GET /api/secrets/list` — enumerating every secret name
- `GET /api/secrets/audit` — dead-key report

If your code reads a new `process.env.X` that isn't in `.devvault.json` yet:

1. Add the mapping to `.devvault.json` (commit-safe, no values).
2. Tell the operator: they grant the new entries via `key-acl-sync --repo ../<this-repo> --key <uuid> [--prune]`.
3. Re-run your dev command.

Operator-only operations (set / lock / audit / grant) use `HADOKU_ADMIN_KEY`. Don't try to escalate: service tier can't write, and there is no key list to add yourself to — auth resolves from the edge-router key registry, which only an admin can write.

Lost or rotating your key? Operator: `python scripts/administration.py key-generate --tier service --repo ../<repo> --name <your-name>-<repo>` then drop the new UUID in `.devvault.local.json`.
