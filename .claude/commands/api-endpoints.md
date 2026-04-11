List all API endpoints with request/response shapes. Base path: `/oss/api`.

## Health & Marking

| Method | Endpoint                 | Response           |
| ------ | ------------------------ | ------------------ |
| GET    | `/health`                | `{ status: "ok" }` |
| GET    | `/openapi.json`          | OpenAPI spec       |
| POST   | `/issues/{issueId}/mark` | Mark issue         |
| DELETE | `/issues/{issueId}/mark` | Unmark issue       |
| GET    | `/issues/marked`         | Marked issues list |

## Recon — Per-Repo Data

| Method | Endpoint                              | Response                    |
| ------ | ------------------------------------- | --------------------------- |
| GET    | `/recon/{slug}/health`                | `RepoHealth`                |
| GET    | `/recon/{slug}/issues`                | `ExtendedIssue[]`           |
| GET    | `/recon/{slug}/scored-issues`         | `ScoredIssue[]`             |
| GET    | `/recon/{slug}/dossier`               | `Dossier`                   |
| GET    | `/recon/{slug}/issue-brief/{issueId}` | SWE agent execution context |
| GET    | `/recon/all-scored-issues`            | `ScoredIssue[]` (all repos) |

Query params for `all-scored-issues`: `?includeKilled=true`, `?page=N`, `?limit=N`, `?sort=cvs`, `?dir=desc`

## Recon — Claims & Triggers

| Method | Endpoint                | Body / Response                                   |
| ------ | ----------------------- | ------------------------------------------------- |
| POST   | `/recon/{slug}/claim`   | `{ issueId, claimedBy, forkIssueUrl? }` → success |
| POST   | `/recon/{slug}/unclaim` | `{ issueId }` → success                           |
| POST   | `/recon/{slug}/refresh` | Triggers scraper re-scrape                        |
| POST   | `/recon/{slug}/compute` | Pre-compute scores/health/dossier for repo        |
| POST   | `/recon/compute-all`    | Pre-compute for all scraped repos                 |

## Key Files

- Route registration: `api/handler.ts`, `api/recon/index.ts`
- Route implementations: `api/recon/issue-routes.ts`, `api/recon/claim-routes.ts`, `api/recon/compute-routes.ts`
- Shared route schemas: `api/recon/route-helpers.ts`
- OpenAPI schemas: `api/schemas.ts`
