CVS (Contribution Viability Score) scoring breakdown. Read `api/recon/issue-scorer.ts` for implementation.

## Composite Formula

```
cvs = repo_score * 0.30 + issue_score * 0.50 + timing_score * 0.20
```

## Repo Score (from RepoHealth)

- `maintainerHealthScore` — PR review patterns, response times, external contributor merge rate
- `mergeAccessibilityScore` — merge rate of external PRs, merge style
- `availabilityScore` — openness to new contributors
- `overallViability` — weighted composite (0 if killed)
- If RepoHealth is null: use neutral `repo_score = 50`, set `dataCompleteness: 'partial'`

## Issue Score (from ExtendedIssue + comments)

- Freshness: issue age (newer = better)
- Activity: comment patterns, reactions, assignee status
- Content quality: bodyPreview analysis (repro steps, code refs)
- Competition level: linked PRs, non-maintainer comments
- Claim detection: internal claims from KV + external "I'll work on this" comments
- Sentiment: pattern-matched comment analysis (-1 to 1)

## Timing Score

Freshness relative to repo's typical response time.

## Tiers

| Range   | Tier   | Meaning                        |
|---------|--------|--------------------------------|
| 85-100  | go     | Strong signal, act immediately |
| 70-84   | likely | Good candidate, worth pursuing |
| 50-69   | maybe  | Proceed with caution           |
| 30-49   | risky  | Significant concerns           |
| 0-29    | skip   | Don't bother                   |

## Kill Signals (repo-level, overrides all issues)

- `isArchived: true`
- No merged PR in 90 days
- No external contributor PR merged in 90 days
- Result: all issues → `cvs: 0`, `cvsTier: 'skip'`, `repoKilled: true`

## Key Files

- CVS scorer: `api/recon/issue-scorer.ts`
- Difficulty heuristics (input to issue_score): `api/scoring.ts`
- Health scorer: `api/recon/health-scorer.ts`
- Lifecycle classifier: `api/recon/lifecycle.ts`
- Sentiment analyzer: `api/recon/sentiment.ts`
- Types/schemas: `api/recon/types.ts`
