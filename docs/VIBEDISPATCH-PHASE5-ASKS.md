# Aggregator asks for vibedispatch Phase 5

**Filed**: 2026-04-26 by vibedispatch
**Context**: vibedispatch Phase 4 closed with the operator-signoff loop
working on a fork-internal preview PR. Phase 5 is the work between
"we _can_ submit one upstream" and "we can let a batch run unattended."
The full vibedispatch plan is in
[crimson-kitty/phase-5-plan.md](https://github.com/WolffM/vibedispatch/blob/main/docs/crimson-kitty/phase-5-plan.md).

This doc is the aggregator-side dependency surface — what we need from
you, ordered by when vibedispatch is blocked on it. Two new asks; the
rest is status-update on the original audit
([VIBEDISPATCH-AUDIT-2026-04-18.md](VIBEDISPATCH-AUDIT-2026-04-18.md)).

---

## TL;DR

| #                 | Ask                                                                         | Priority    | Blocks                                  | By when                                                    |
| ----------------- | --------------------------------------------------------------------------- | ----------- | --------------------------------------- | ---------------------------------------------------------- |
| [P5-1](#p5-1)     | New endpoint: `GET /recon/{slug}/contribution-conventions`                  | **Blocker** | vibedispatch Phase 5.3 (auto-rejection) | Before Phase 5.3 ships                                     |
| [P5-2](#p5-2)     | Extend `notify_human_comment` payload with PR review-comment classification | Medium      | vibedispatch Phase 5.1 (response loop)  | Optional; vibedispatch can compute locally if not provided |
| [Status](#status) | Original audit (A1–A4, M1–M2)                                               | —           | —                                       | Status verification                                        |

---

## P5-1 — `/recon/{slug}/contribution-conventions`

### Why we need it

Right now vibedispatch hardcodes:

- `Fixes #N` close keyword in the PR body
- No `Signed-off-by` line in commits
- No commit-title prefix scheme (Conventional Commits, repo-specific, etc.)

A submission to apache/_ (DCO required), kubernetes/_ (strict commit
prefix rules), or any repo whose CONTRIBUTING.md says "do not include
Fixes in body" gets auto-closed before a human even looks at it. We
have no way to detect those rules from the existing aggregator
endpoints — `/contributing` exposes ai_policy but not the rest of the
contribution policy surface.

### Proposed contract

```
GET /recon/{slug}/contribution-conventions

200 OK:
{
  "success": true,
  "data": {
    "commit_style": "conventional" | "freeform" | "prefix-required",
    "title_prefix_pattern": string | null,
    // Examples:
    //   "^(fix|feat|docs|chore)(\\(.+\\))?: .+$"   (conventional commits)
    //   "^[A-Z]+-\\d+: .+$"                       (JIRA-style)
    //   null                                       (no enforced pattern)

    "signoff_required": boolean,
    // True when CONTRIBUTING.md mentions DCO, Signed-off-by, "git commit -s"

    "body_structure": string[],
    // Required PR body sections in order, e.g. ["Summary", "Why", "Test plan"]
    // Empty array when no specific structure is enforced.
    // Same source as the existing pr-template endpoint, just normalized.

    "references": {
      "close_keyword": "Fixes" | "Closes" | "Resolves" | null,
      "syntax": "Fixes #N" | "Closes #N" | null,
      "in_body": boolean
      // Some repos forbid Fixes in body, requiring it only in commit
      // messages. Detected by phrases like "do not put Fixes in PR body".
    },

    "evidence": {
      "source": "contributing" | "pr-template" | "merged-commits" | "default",
      "raw_excerpt": string  // First 500 chars of the source for audit
    }
  }
}
```

### How to derive it

You already scrape CONTRIBUTING.md (see `crimson-kitty-routes.ts ›
parseContributing`). Extend that parser to also return the DCO /
prefix / close-keyword signals. Three signal sources, in priority:

1. **CONTRIBUTING.md regex matches** — primary source. Patterns:
   - DCO: `/sign-?off-?by|DCO|developer certificate of origin/i`
   - Conventional Commits: `/conventional commits|commit message convention/i`
   - Close keyword forbidden in body: `/do not.*[Ff]ixes.*body|use commit message.*Closes/i`

2. **Last 50 merged commits** (if `commit_style` is still ambiguous):
   sample the most recent 50 merged-PR commit subjects. If ≥80% match
   `^(fix|feat|docs|chore)(\(.+\))?: ` → `commit_style="conventional"`.
   If they share a different prefix pattern → `commit_style="prefix-required"`.

3. **Default fallback** when neither signal fires:
   ```json
   {
     "commit_style": "freeform",
     "title_prefix_pattern": null,
     "signoff_required": false,
     "body_structure": [],
     "references": { "close_keyword": "Fixes", "syntax": "Fixes #N", "in_body": true }
   }
   ```

### Acceptance criteria

- Endpoint returns the bundle for any slug that has a successful
  CONTRIBUTING.md fetch (already true for the eligibility flow).
- Endpoint returns the default fallback (not 404) for repos without
  CONTRIBUTING.md — vibedispatch needs _some_ answer.
- Confirmed correct on 5 spot-check repos (suggested):
  - `apache/airflow` → `signoff_required=true`, `commit_style="freeform"`
  - `kubernetes/kubernetes` → `signoff_required=true`, `commit_style="prefix-required"`, prefix pattern populated
  - `prettier/prettier` → no signoff, no prefix pattern
  - `nuxt/nuxt` → likely `commit_style="conventional"`, no signoff
  - `vuejs/core` → likely `commit_style="conventional"`, no signoff

### When vibedispatch is blocked

vibedispatch Phase 5.3 builds local consumption of this bundle.
Without the endpoint, Phase 5.3 ships with a hardcoded fallback
matching the default — which is exactly what's hardcoded today, so
no progress. Phase 5.3 can land _behind_ the endpoint's availability
since vibedispatch can begin with the fallback and switch to live
data once the endpoint exists.

**Net**: vibedispatch is not BLOCKED on this — Phase 5.3's local
work can ship anyway and just pulls the default until the endpoint
goes live. But until both sides land, vibedispatch shouldn't dispatch
to DCO-required repos at scale.

---

## P5-2 — Optional: PR review-comment classification

### Why we'd want it

vibedispatch Phase 5.1 builds a post-submission lifecycle: after the
upstream PR is opened, we poll for state changes (open/closed/merged)
and watch for new review comments. When a maintainer leaves a
**blocking** review comment, we route it back through the agent
remediation loop. When they leave a nit / question, we surface in the
operator inbox.

The classification (blocking vs nit vs question vs approval) is
something the aggregator could compute centrally — it's the same
sentiment / severity classification used today on issue comments
(see `comment-digest.ts`). Doing it server-side means:

- Consistent with how issue comments are already classified
- Cached per-repo so vibedispatch doesn't re-classify every poll cycle
- Other consumers benefit if any future ones materialize

### Proposed shape

Extend the existing `/recon/{slug}/scored-issues` model to PRs, or
create a new `/recon/{slug}/pr/{n}/comments` endpoint:

```
GET /recon/{slug}/pr/{pr_number}/review-state

200 OK:
{
  "success": true,
  "data": {
    "merged_at": string | null,
    "closed_at": string | null,
    "review_comments": [
      {
        "id": number,
        "author": string,
        "body": string,
        "severity": "blocking" | "suggested" | "nit" | "approval",
        "created_at": string,
        "is_human": boolean,    // existing bot_filter logic
        "in_review": boolean    // true if part of a Pending Changes review
      }
    ],
    "blocking_count": number,   // shortcut for vibedispatch's poll loop
    "approved_by": string[]     // logins of approving reviewers
  }
}
```

### When vibedispatch is blocked

Not blocked. vibedispatch can implement the polling locally for Phase
5.1 — the heuristics for blocking-vs-nit are simple enough to ship
duplicated. This ask is **lower priority** and would only be worth
doing if other consumers materialize.

**Recommendation**: skip this for now unless aggregator-side bandwidth
allows. Revisit when vibedispatch's local classifier proves
inadequate or when a second consumer (e.g., a Discord bot) wants the
same data.

---

## Status — original audit

The original audit
([VIBEDISPATCH-AUDIT-2026-04-18.md](VIBEDISPATCH-AUDIT-2026-04-18.md))
was filed 2026-04-18. Looking at the aggregator git log, most items
appear addressed by `a74debb feat(recon): act on vibedispatch Phase-4
audit findings` and follow-ups. This is a status check, not new work:

| #   | Original ask                                    | Apparent status     | Verification                                                     |
| --- | ----------------------------------------------- | ------------------- | ---------------------------------------------------------------- |
| A1  | `/issue-brief/{id}` breaks on hyphenated owners | **Need to verify**  | Test: `curl /recon/oven-sh-bun/issue-brief/<some-id>` succeeds   |
| A2  | `ai_policy` always `"unknown"`                  | **Likely fixed**    | vibedispatch Phase 4 saw llama.cpp correctly classified `banned` |
| A3  | `killed: false` on wound-down repos             | Fixed via `7ba291f` | (`fix(recon): propagate health.killed to repoKilled`)            |
| A4  | `AGENTS.md` never fetched                       | **Need to verify**  | Check whether AGENTS.md is in `RepoMeta`                         |
| M1  | `likelyFiles` coverage inconsistent             | **Status unknown**  | Spot-check 5 repos                                               |
| M2  | Rich signals undocumented                       | **Status unknown**  | Update API docs / OpenAPI spec                                   |

**Ask:** if anything in the table above is "actually still broken,"
flag back so we can co-prioritize against the P5 items. The
verification work is a one-hour spike on the aggregator side; happy
to drive it from vibedispatch instead if you prefer.

---

## Timeline summary

vibedispatch's Phase 5 dependency surface, ranked by criticality:

```
phase 5.1 (post-submission) — vibedispatch ships independently
phase 5.2 (remediation)     — vibedispatch ships independently
phase 5.3 (conventions)     — needs P5-1 endpoint (NEW)
phase 5.4 (inbox UI)        — vibedispatch ships independently
phase 5.5 (calibration)     — vibedispatch ships independently
```

**Hard dependency**: only P5-1, blocking only Phase 5.3.

**Soft dependency**: P5-2 would simplify Phase 5.1 but isn't required
— vibedispatch's plan shows local implementation as the default path.

If the aggregator team picks up P5-1 in the next ~1 working week,
vibedispatch and aggregator land Phase 5.3 together with no extra
sequencing constraint. If P5-1 slips past 2 weeks, vibedispatch
ships Phase 5.3 with the hardcoded default and we backfill
convention awareness later as a no-code-change upgrade.
