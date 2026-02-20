# Scraper Integration Specification

This document defines the contract between **hadoku-aggregator** (this repo) and **hadoku-scraper**. It covers every upstream API call, the expected output schema, KV storage conventions, testing guidance, and done criteria.

---

## Architecture Overview

```
hadoku-scraper (cron / GitHub Actions)
  │
  │  fetches from upstream APIs (GitHub, GitLab, Gitea, etc.)
  │  normalizes + scores issues
  │  writes to Cloudflare KV
  │
  ▼
Cloudflare KV (CACHE_KV namespace)
  │
  │  read by aggregator at request time
  │
  ▼
hadoku-aggregator API (Cloudflare Worker)
  │
  │  serves /oss/api/* endpoints
  │
  ▼
hadoku-site (frontend)
```

The scraper runs on a schedule, fetches issues from all upstream platforms, normalizes them into a common schema, and writes them directly to the Cloudflare KV namespace that the aggregator reads from. The aggregator's `LiveApiProvider` (real-time API calls) will be replaced by a `CachedProvider` that reads exclusively from KV.

---

## KV Storage Convention

### Key format

```
cached:{slug}
```

Where `{slug}` matches a project slug from the config (e.g., `cached:pytorch`, `cached:vlc`, `cached:linux-kernel`).

### Value format

```json
{
  "issues": [
    /* array of Issue objects — see schema below */
  ],
  "cachedAt": "2026-02-20T12:00:00.000Z",
  "source": "hadoku-scraper"
}
```

TypeScript type (already defined in `api/types.ts`):

```typescript
interface CachedIssues {
  issues: Issue[]
  cachedAt: string // ISO 8601 timestamp of when this cache was written
  source: string // identifier for the data source, e.g. "hadoku-scraper"
}
```

### Write access

The scraper will need a **Cloudflare API token** with KV write permissions for the `CACHE_KV` namespace. This can be provided via:

- A GitHub Actions secret (`CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_KV_NAMESPACE_ID`)
- Direct Cloudflare Workers KV REST API calls:
  ```
  PUT https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/{key}
  ```

---

## Normalized Issue Schema

Every issue from every platform must be normalized to this shape before writing to KV:

```typescript
interface Issue {
  id: string // "{platform}-{slug}-{number_or_id}"
  platform: Platform // "github" | "gitlab" | "gitea" | "phabricator" | "bugzilla" | "trac"
  project: string // Human-readable project name (e.g., "PyTorch", "React")
  title: string // Issue title
  url: string // Web URL to view the issue in a browser
  difficulty: Difficulty // "beginner" | "intermediate" | "advanced" | "unknown"
  difficultyScore: number // 0-100, lower = easier
  difficultySignals: string[] // Which scoring heuristics matched
  labels: string[] // All labels/tags on the issue
  createdAt: string // ISO 8601
  updatedAt: string // ISO 8601
  author: string // Username or identifier of the issue author
}
```

### Difficulty scoring

The scoring logic lives in `api/scoring.ts` in this repo. The scraper should either:

1. **Import and use it directly** (preferred — keeps scoring consistent), or
2. **Include `difficulty: "unknown"`, `difficultyScore: 50`, `difficultySignals: []`** and let the aggregator re-score at read time.

Scoring inputs needed:

- `title` — issue title
- `body` — issue body/description (optional, improves accuracy)
- `labels` — all labels on the issue
- `beginnerLabels` — the project's configured beginner labels (from config below)

---

## Upstream API Calls — Complete Reference

### Project Configuration

The full project list is in `api/config.ts`. Each project has:

```typescript
interface ProjectConfig {
  slug: string // Unique identifier
  name: string // Display name
  platform: Platform // Which API to use
  apiBase: string // Base URL for API calls
  projectId: string // Repo path or project identifier
  beginnerLabels: string[] // Labels that indicate beginner-friendly issues
  contributingUrl: string // Link to contributing guide
  pool: string[] // Category pools (e.g., ["ml-ai", "all"])
}
```

---

### 1. GitHub (REST API v3)

**Request:**

```
GET {apiBase}/repos/{projectId}/issues?labels={label}&state=open&per_page=100
```

- **Auth:** `Authorization: token {GITHUB_TOKEN}` (recommended for rate limits)
- **Headers:** `Accept: application/vnd.github.v3+json`
- **Important:** Make one request **per label** (GitHub's labels param uses AND logic for multiple labels). Deduplicate results by `id` field.
- **Filter:** Exclude any item where `pull_request` field is present.

**Response fields → Issue mapping:**

| API field       | Issue field | Notes                              |
| --------------- | ----------- | ---------------------------------- |
| `number`        | `id`        | Format: `"github-{slug}-{number}"` |
| `title`         | `title`     |                                    |
| `body`          | —           | Used for scoring only              |
| `html_url`      | `url`       |                                    |
| `labels[].name` | `labels`    |                                    |
| `created_at`    | `createdAt` | Already ISO 8601                   |
| `updated_at`    | `updatedAt` | Already ISO 8601                   |
| `user.login`    | `author`    | Fallback: `"unknown"`              |

**Projects:**

| Slug                       | projectId                     | beginnerLabels                                  |
| -------------------------- | ----------------------------- | ----------------------------------------------- |
| `pytorch`                  | `pytorch/pytorch`             | `good first issue`, `bootcamp`                  |
| `react`                    | `facebook/react`              | `good first issue`, `Difficulty: starter`       |
| `nodejs`                   | `nodejs/node`                 | `good first issue`                              |
| `huggingface-transformers` | `huggingface/transformers`    | `Good First Issue`, `Good Second Issue`         |
| `openlibrary`              | `internetarchive/openlibrary` | `Good First Issue`, `Hacktoberfest`             |
| `tensorflow`               | `tensorflow/tensorflow`       | `good first issue`, `stat:contribution welcome` |
| `langchain`                | `langchain-ai/langchain`      | `good first issue`, `help wanted`               |
| `langchainjs`              | `langchain-ai/langchainjs`    | `good first issue`, `help wanted`               |
| `langgraphjs`              | `langchain-ai/langgraphjs`    | `good first issue`, `help wanted`               |
| `mastra`                   | `mastra-ai/mastra`            | `good first issue`, `help wanted`               |
| `onnxruntime`              | `microsoft/onnxruntime`       | `contributions welcome`                         |
| `deepspeed`                | `deepspeedai/DeepSpeed`       | `good first issue`, `help wanted`               |
| `dapr`                     | `dapr/dapr`                   | `good first issue`, `help wanted`               |
| `vscode`                   | `microsoft/vscode`            | `good first issue`, `help wanted`               |
| `playwright`               | `microsoft/playwright`        | `open-to-a-pull-request`                        |

---

### 2. GitLab (API v4)

**Request:**

```
GET {apiBase}/projects/{projectId_urlencoded}/issues?labels={labels_comma_joined}&state=opened&per_page=100
```

- **Auth:** None required for public projects
- **Notes:** `projectId` must be URL-encoded (e.g., `videolan%2Fvlc`). Labels are comma-joined.

**Response fields → Issue mapping:**

| API field         | Issue field | Notes                           |
| ----------------- | ----------- | ------------------------------- |
| `iid`             | `id`        | Format: `"gitlab-{slug}-{iid}"` |
| `title`           | `title`     |                                 |
| `description`     | —           | Used for scoring only           |
| `web_url`         | `url`       |                                 |
| `labels[]`        | `labels`    | Already plain strings           |
| `created_at`      | `createdAt` | Already ISO 8601                |
| `updated_at`      | `updatedAt` | Already ISO 8601                |
| `author.username` | `author`    | Fallback: `"unknown"`           |

**Projects:**

| Slug  | apiBase                            | projectId      | beginnerLabels     |
| ----- | ---------------------------------- | -------------- | ------------------ |
| `vlc` | `https://code.videolan.org/api/v4` | `videolan/vlc` | `Difficulty::easy` |

---

### 3. Gitea (API v1)

**Request:**

```
GET {apiBase}/repos/{projectId}/issues?labels={labels_comma_joined}&state=open&limit=50
```

- **Auth:** None required for public projects
- **Filter:** Exclude items where `pull_request` field is present.

**Response fields → Issue mapping:**

| API field       | Issue field | Notes                             |
| --------------- | ----------- | --------------------------------- |
| `number`        | `id`        | Format: `"gitea-{slug}-{number}"` |
| `title`         | `title`     |                                   |
| `body`          | —           | Used for scoring only             |
| `html_url`      | `url`       |                                   |
| `labels[].name` | `labels`    |                                   |
| `created_at`    | `createdAt` | Already ISO 8601                  |
| `updated_at`    | `updatedAt` | Already ISO 8601                  |
| `user.login`    | `author`    | Fallback: `"unknown"`             |

**Projects:**

| Slug      | apiBase                               | projectId         | beginnerLabels     |
| --------- | ------------------------------------- | ----------------- | ------------------ |
| `blender` | `https://projects.blender.org/api/v1` | `blender/blender` | `Good First Issue` |

---

### 4. Phabricator (Conduit API)

**Request:**

```
POST {apiBase}/maniphest.search
Content-Type: application/x-www-form-urlencoded

api.token={PHABRICATOR_TOKEN}&constraints[projects][0]={projectPHID}&constraints[statuses][0]=open&limit=100
```

- **Auth:** `PHABRICATOR_TOKEN` is required (passed in form body, not header).

**Response structure:** `{ result: { data: [...] }, error_code: null }`

**Response fields → Issue mapping:**

| API field                | Issue field | Notes                                               |
| ------------------------ | ----------- | --------------------------------------------------- |
| `id`                     | `id`        | Format: `"phabricator-{slug}-{id}"`                 |
| `id`                     | `url`       | Format: `"https://phabricator.wikimedia.org/T{id}"` |
| `fields.name`            | `title`     |                                                     |
| `fields.description.raw` | —           | Used for scoring only                               |
| `fields.dateCreated`     | `createdAt` | **Unix timestamp (seconds)** — convert to ISO 8601  |
| `fields.dateModified`    | `updatedAt` | **Unix timestamp (seconds)** — convert to ISO 8601  |
| `fields.authorPHID`      | `author`    | This is a PHID, not a readable username             |

**Projects:**

| Slug        | apiBase                                 | projectPHID                      | beginnerLabels    |
| ----------- | --------------------------------------- | -------------------------------- | ----------------- |
| `mediawiki` | `https://phabricator.wikimedia.org/api` | `PHID-PROJ-onnxucoedheq3jevknyr` | `good first task` |

---

### 5. Bugzilla (REST API)

**Request:**

```
GET {apiBase}/bug?keywords={keywords_comma_joined}&status=NEW&status=ASSIGNED&status=REOPENED&limit=100
```

- **Auth:** None
- **Headers:** `Accept: application/json`
- **User-Agent:** Must use a browser-like UA string. kernel.org blocks bot user agents.
- **⚠️ BLOCKED:** kernel.org blocks Cloudflare Worker IPs. The scraper running from GitHub Actions (or another non-CF IP) is required.

**Response structure:** `{ bugs: [...] }`

**Response fields → Issue mapping:**

| API field          | Issue field | Notes                                                     |
| ------------------ | ----------- | --------------------------------------------------------- |
| `id`               | `id`        | Format: `"bugzilla-{slug}-{id}"`                          |
| `id`               | `url`       | Format: `"{apiBase_without_rest}/show_bug.cgi?id={id}"`   |
| `summary`          | `title`     |                                                           |
| `keywords[]`       | `labels`    | Combine with `component` and `severity` (if not "normal") |
| `component`        | `labels`    | Append to labels array                                    |
| `severity`         | `labels`    | Append if value is not `"normal"`                         |
| `creation_time`    | `createdAt` | Already ISO 8601                                          |
| `last_change_time` | `updatedAt` | Already ISO 8601                                          |
| `creator`          | `author`    |                                                           |

**Projects:**

| Slug           | apiBase                            | keywords  |
| -------------- | ---------------------------------- | --------- |
| `linux-kernel` | `https://bugzilla.kernel.org/rest` | `trivial` |

---

### 6. Trac (Query API — CSV format)

**Request:**

```
GET {apiBase}?status=new&status=open&status=assigned&keywords=~{keyword}&format=csv&col=id&col=summary&col=status&col=keywords&col=reporter&col=time&col=changetime&col=type&col=priority&col=component&max=100
```

- **Auth:** None
- **Headers:** `Accept: text/csv`
- **User-Agent:** Must use a browser-like UA string. ffmpeg.org blocks bot user agents.
- **Response format:** CSV (not JSON). Parse with a standard CSV parser.
- **⚠️ BLOCKED:** ffmpeg.org blocks Cloudflare Worker IPs. The scraper is required.
- **Note:** Make one request per keyword. Deduplicate results by `id`.

**CSV columns → Issue mapping:**

| CSV column   | Issue field | Notes                                                               |
| ------------ | ----------- | ------------------------------------------------------------------- |
| `id`         | `id`        | Format: `"trac-{slug}-{id}"`                                        |
| `id`         | `url`       | Format: `"{apiBase_without_query}/ticket/{id}"`                     |
| `summary`    | `title`     |                                                                     |
| `keywords`   | `labels`    | Split by whitespace/commas, combine with type/priority/component    |
| `type`       | `labels`    | Append to labels array                                              |
| `priority`   | `labels`    | Append if value is not `"normal"`                                   |
| `component`  | `labels`    | Append to labels array                                              |
| `reporter`   | `author`    | Fallback: `"unknown"`                                               |
| `time`       | `createdAt` | **May be locale string** (e.g., "Jan 16, 2019") — parse to ISO 8601 |
| `changetime` | `updatedAt` | Same parsing needed                                                 |

**Projects:**

| Slug     | apiBase                         | keywords |
| -------- | ------------------------------- | -------- |
| `ffmpeg` | `https://trac.ffmpeg.org/query` | `easy`   |

---

## Scraper Implementation Prompt

> You are building **hadoku-scraper**, a scheduled job that fetches beginner-friendly open-source issues from multiple platforms and writes them to Cloudflare KV for the hadoku-aggregator to serve.
>
> ### What to build
>
> A Node.js/TypeScript script (or GitHub Action) that:
>
> 1. **Reads the project list** — either from a shared config or hardcoded from the table in this doc. Each project has a `slug`, `platform`, `apiBase`, `projectId`, `beginnerLabels`, `name`, and `pool`.
> 2. **For each project, fetches open beginner-friendly issues** from the upstream API using the exact request format documented above per platform.
> 3. **Normalizes each issue** into the `Issue` schema (see above). Pay attention to:
>    - ID format: `"{platform}-{slug}-{number_or_id}"`
>    - Date parsing: Phabricator uses Unix timestamps, Trac may use locale date strings
>    - Label aggregation: Bugzilla and Trac combine multiple fields into labels
>    - PR filtering: GitHub and Gitea include PRs in the issues endpoint — filter them out
>    - Deduplication: GitHub and Trac need per-label fetching with dedup by ID
> 4. **Scores each issue for difficulty** using the scoring logic from `api/scoring.ts` (can be copied or imported). Input: `{ title, body, labels, beginnerLabels }`. Output: `{ difficulty, score, signals }`.
> 5. **Writes the results to Cloudflare KV** via the REST API:
>
>    ```
>    PUT https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/storage/kv/namespaces/{CF_KV_NAMESPACE_ID}/values/cached:{slug}
>    Authorization: Bearer {CF_API_TOKEN}
>    Content-Type: application/json
>
>    {
>      "issues": [...],
>      "cachedAt": "2026-02-20T12:00:00.000Z",
>      "source": "hadoku-scraper"
>    }
>    ```
>
> 6. **Runs on a schedule** — every 30 minutes via GitHub Actions cron, or similar.
>
> ### Environment variables needed
>
> | Variable             | Required    | Purpose                                                  |
> | -------------------- | ----------- | -------------------------------------------------------- |
> | `GITHUB_TOKEN`       | Recommended | GitHub API auth (avoids 60 req/hr unauthenticated limit) |
> | `PHABRICATOR_TOKEN`  | Yes         | Wikimedia Phabricator Conduit API token                  |
> | `CF_API_TOKEN`       | Yes         | Cloudflare API token with KV write access                |
> | `CF_ACCOUNT_ID`      | Yes         | Cloudflare account ID                                    |
> | `CF_KV_NAMESPACE_ID` | Yes         | KV namespace ID for CACHE_KV                             |
>
> ### Error handling
>
> - If a single project fails, log the error and continue with the remaining projects. Do not fail the entire run.
> - If KV write fails, retry once, then log and continue.
> - Use browser-like User-Agent for Bugzilla (kernel.org) and Trac (ffmpeg.org) — they block bot UAs.

---

## Testing

### Unit tests for the scraper

1. **Normalization tests** — For each platform, provide a sample API response and verify the output matches the `Issue` schema exactly (correct `id` format, ISO dates, labels array, etc.).

2. **Scoring tests** — Provide issues with known labels/titles and verify difficulty classification matches expectations.

3. **Deduplication tests** — For GitHub and Trac, verify that issues appearing under multiple labels are deduplicated by ID.

4. **Error isolation tests** — Simulate one project failing and verify others still succeed.

### Integration test against live APIs

```bash
# Run the scraper in dry-run mode (fetch but don't write to KV)
SCRAPER_DRY_RUN=true node scraper.js
```

Should output a JSON summary:

```json
{
  "projects": 20,
  "succeeded": 18,
  "failed": 2,
  "totalIssues": 347,
  "results": {
    "pytorch": { "count": 42, "status": "ok" },
    "react": { "count": 3, "status": "ok" },
    ...
  }
}
```

### End-to-end validation

After scraper writes to KV, verify via the aggregator API:

```bash
# Check a specific project
curl https://hadoku.me/oss/api/issues/pytorch | jq '.data.issues | length'

# Check a pool
curl https://hadoku.me/oss/api/issues?pool=all | jq '.data.issueCount'

# Verify schema compliance
curl https://hadoku.me/oss/api/issues/pytorch | jq '.data.issues[0] | keys'
# Should output: ["author","createdAt","difficulty","difficultyScore","difficultySignals","id","labels","platform","project","title","updatedAt","url"]
```

---

## Done Criteria

The scraper integration is **complete** when:

- [ ] Scraper fetches issues from all 6 platforms (GitHub, GitLab, Gitea, Phabricator, Bugzilla, Trac)
- [ ] All issues conform to the `Issue` schema with correct `id` format per platform
- [ ] Difficulty scoring is applied to all issues
- [ ] Results are written to KV under `cached:{slug}` keys with the `CachedIssues` schema
- [ ] Scraper runs on a cron schedule (every 30 minutes recommended)
- [ ] Aggregator's data provider is swapped from `LiveApiProvider` to a `CachedProvider` that reads from KV
- [ ] All upstream API calls are removed from the aggregator's hot path (no more real-time fetching)
- [ ] Blocked platforms (Bugzilla/kernel.org, Trac/ffmpeg.org) return data reliably via the scraper
- [ ] Dry-run mode works for local development and CI testing
- [ ] Errors in one project don't prevent others from being scraped and cached
- [ ] The aggregator API returns the same shape of data as before (no frontend changes needed)

---

## Aggregator Changes Needed After Scraper Is Ready

1. Create `api/data-sources/cached-provider.ts` implementing `IssueDataProvider` that reads from `CACHE_KV`
2. Update `api/data-sources/index.ts` `createDataProvider()` to return the `CachedProvider`
3. Optionally keep `LiveApiProvider` as a fallback if KV cache is empty/stale
4. The `api/adapters/` directory can be removed once the scraper fully replaces it
