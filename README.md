# OSS Issue Aggregator

> Intelligence + API layer for the OSS contribution pipeline

Scores open source issues for contribution viability, analyzes repo health, and compiles contribution dossiers. Part of the hadoku pipeline: **hadoku-scrape** (data collection) → **hadoku-aggregator** (analysis + API) → **vibedispatch** (orchestration + UI).

**Live at:** [hadoku.me/aggregator](https://hadoku.me/aggregator)

## Features

- **Recon Pipeline**: Scores issues using CVS (Contribution Viability Score) combining repo health, issue quality, and timing signals
- **Repo Health Analysis**: Maintainer activity, merge accessibility, contributor availability, kill signal detection
- **Dossier Compilation**: 6-section markdown contribution guides per repo (overview, rules, success patterns, anti-patterns, issue board, setup)
- **Dynamic Discovery**: Projects discovered automatically from KV — no hardcoded project lists
- **Multi-Platform**: GitHub, GitLab, Gitea, Phabricator, Bugzilla, and Trac
- **Issue Lifecycle**: Classifies issues as fresh, triaged, accepted, stale, or zombie
- **Sentiment Analysis**: Pattern-matched comment sentiment scoring
- **Quirk Detection**: Identifies changesets, CLA, conventional commits, branch targeting requirements
- **Beautiful Themes**: 16 light/dark theme options
- **Responsive Design**: Works on desktop and mobile

## Package Exports

This package provides both UI components and API logic:

```typescript
// UI components (React)
import { OSSAggregator } from '@wolffm/oss-aggregator'
import '@wolffm/oss-aggregator/style.css'

// API handler (Cloudflare Workers)
import { createOSSHandler, type OSSEnv } from '@wolffm/oss-aggregator/api'
```

## Development

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Build (UI + API)
pnpm build

# Run tests
pnpm test

# Lint
pnpm lint
```

### Build Output

The build produces:

```
dist/
├── index.js          # UI bundle (React components)
├── style.css         # UI styles
└── api/
    └── index.js      # API bundle (Hono handler)
```

## API Usage

### For Cloudflare Workers

```typescript
import { createOSSHandler, type OSSEnv } from '@wolffm/oss-aggregator/api'

// Create handler with base path
const app = createOSSHandler('/oss/api')

export default app
```

### Environment Variables

| Variable            | Required | Description                                 |
| ------------------- | -------- | ------------------------------------------- |
| `CACHE_KV`          | Yes      | Cloudflare KV namespace binding             |
| `SCRAPER_API_URL`   | Yes      | hadoku-scrape base URL for trigger calls    |
| `SCRAPER_API_KEY`   | Yes      | API key for scraper authentication          |
| `GITHUB_TOKEN`      | Optional | GitHub PAT (legacy, used by marking system) |
| `PHABRICATOR_TOKEN` | Optional | Phabricator API token (legacy)              |

### API Endpoints

All paths are relative to the base path (e.g., `/oss/api`).

#### Health & Marking

| Method | Endpoint                 | Description                     |
| ------ | ------------------------ | ------------------------------- |
| GET    | `/health`                | Health check                    |
| GET    | `/openapi.json`          | OpenAPI specification           |
| POST   | `/issues/{issueId}/mark` | Mark an issue (ignored/process) |
| DELETE | `/issues/{issueId}/mark` | Unmark an issue                 |
| GET    | `/issues/marked`         | Get marked issues by status     |

#### Recon Pipeline — Per-Repo Data

| Method | Endpoint                              | Description                              |
| ------ | ------------------------------------- | ---------------------------------------- |
| GET    | `/recon/{slug}/health`                | Computed repo health scores              |
| GET    | `/recon/{slug}/issues`                | Raw unscored issues from KV              |
| GET    | `/recon/{slug}/scored-issues`         | Issues with CVS scores                   |
| GET    | `/recon/{slug}/dossier`               | Contribution intelligence dossier        |
| GET    | `/recon/{slug}/issue-brief/{issueId}` | SWE agent execution context for an issue |
| GET    | `/recon/all-scored-issues`            | All scored issues across all repos       |

#### Recon Pipeline — Claims & Triggers

| Method | Endpoint                | Description                       |
| ------ | ----------------------- | --------------------------------- |
| POST   | `/recon/{slug}/claim`   | Report an issue claim             |
| POST   | `/recon/{slug}/unclaim` | Remove an issue claim             |
| POST   | `/recon/{slug}/refresh` | Trigger scraper re-scrape         |
| POST   | `/recon/{slug}/compute` | Pre-compute scores/health/dossier |
| POST   | `/recon/compute-all`    | Pre-compute for all scraped repos |

## Data Flow

```
hadoku-scrape (cron)
  │  fetches from upstream APIs
  │  writes consolidated data to KV
  ▼
Cloudflare KV
  │  recon:{slug}              → scraper data (issues, PRs, meta, comments)
  │  recon:{slug}:health       → aggregator-computed health scores
  │  recon:{slug}:scored-issues → CVS-scored issues
  │  recon:{slug}:dossier      → compiled dossier
  │  recon:{slug}:claims       → claim tracking
  ▼
hadoku-aggregator API (this repo)
  │  reads scraper data, runs analysis, serves results
  ▼
vibedispatch (UI + orchestration)
```

## Versioning

This package uses automatic versioning with dual safeguards:

1. **Pre-commit Hook** (Primary): Bumps patch version when code changes are committed
2. **Workflow Check** (Safety Net): Checks registry and bumps if version exists

Version format: `major.minor.patch` with automatic rollover at `.20`.

## License

MIT
