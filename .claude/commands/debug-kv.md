Debug KV data issues. Print the KV key patterns and walk through common problems.

## KV Key Patterns

Scraper-written (one consolidated key per repo):
- `recon:{slug}` → `ConsolidatedReconData` (issues, mergedPrs, rejectedPrs, repoMeta, comments)

Aggregator-written (computed analysis):
- `recon:{slug}:health` → `RepoHealth`
- `recon:{slug}:scored-issues` → `ScoredIssue[]`
- `recon:{slug}:dossier` → `Dossier`
- `recon:{slug}:claims` → `ClaimRecord[]`

## Slug Format

Slugs use hyphenated `{owner}-{repo}` format (e.g., `fastify-fastify`, `pytorch-pytorch`).
The `owner` and `repo` fields are stored separately in `RepoMeta`.

## Common Issues

1. **Stale data**: Check `scrapedAt` field in consolidated data — if >24h old, trigger refresh
2. **Missing health/scores**: Pre-compute hasn't run — call `POST /recon/{slug}/compute`
3. **Empty slug list**: `getScrapedSlugs()` lists KV keys with `recon:` prefix — scraper hasn't written yet
4. **Partial data**: `dataCompleteness: 'partial'` means health wasn't available during scoring

## Key Files

- KV reader: `api/recon/kv-reader.ts`
- KV writer: `api/recon/kv-writer.ts`
- Types: `api/recon/types.ts` (Zod schemas define the shapes)
- Consolidated data type: `ConsolidatedReconData` in `api/recon/types.ts`
