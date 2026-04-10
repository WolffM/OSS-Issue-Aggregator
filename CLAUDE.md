# hadoku-aggregator

Dual-output npm package: React UI components + Hono API handler for OSS issue intelligence.
Published as `@wolffm/oss-aggregator` to GitHub Packages.

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

- Publishes: `@wolffm/oss-aggregator` package (UI + API exports)
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
- `SCRAPER_API_URL` + `SCRAPER_API_KEY`: for triggering scraper (required)
- `GITHUB_TOKEN`, `PHABRICATOR_TOKEN`: legacy marking (optional)
