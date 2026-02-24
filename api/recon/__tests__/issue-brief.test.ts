import { describe, it, expect } from 'vitest'
import { formatIssueBrief } from '../issue-brief'
import { makeScoredIssue, makeRepoHealth, makeRepoMeta, makePRSample } from './helpers'

describe('formatIssueBrief', () => {
  const defaultIssue = makeScoredIssue()
  const defaultHealth = makeRepoHealth()
  const defaultMeta = makeRepoMeta()
  const defaultMerged = [makePRSample()]
  const defaultRejected: ReturnType<typeof makePRSample>[] = []

  function brief(
    overrides: {
      issue?: Parameters<typeof makeScoredIssue>[0]
      health?: Parameters<typeof makeRepoHealth>[0]
      meta?: Parameters<typeof makeRepoMeta>[0]
      merged?: ReturnType<typeof makePRSample>[]
      rejected?: ReturnType<typeof makePRSample>[]
    } = {}
  ) {
    return formatIssueBrief(
      overrides.issue ? makeScoredIssue(overrides.issue) : defaultIssue,
      overrides.health ? makeRepoHealth(overrides.health) : defaultHealth,
      overrides.meta ? makeRepoMeta(overrides.meta) : defaultMeta,
      overrides.merged ?? defaultMerged,
      overrides.rejected ?? defaultRejected
    )
  }

  // ---- Structure ----

  it('produces markdown with all required sections', () => {
    const result = brief()
    expect(result).toContain('# Task:')
    expect(result).toContain('## CRITICAL RULES (Read First)')
    expect(result).toContain('## Environment Setup')
    expect(result).toContain('## Issue Details')
    expect(result).toContain('## Contribution Rules (MUST FOLLOW)')
    expect(result).toContain('## What Gets PRs Merged Here')
    expect(result).toContain('## What Gets PRs Rejected')
    expect(result).toContain('## Quirks & Blockers')
    expect(result).toContain('## Environment')
  })

  it('places CRITICAL RULES before Issue Details', () => {
    const result = brief()
    const rulesIdx = result.indexOf('## CRITICAL RULES (Read First)')
    const detailsIdx = result.indexOf('## Issue Details')
    expect(rulesIdx).toBeLessThan(detailsIdx)
  })

  it('places Environment Setup before Issue Details', () => {
    const result = brief()
    const setupIdx = result.indexOf('## Environment Setup')
    const detailsIdx = result.indexOf('## Issue Details')
    expect(setupIdx).toBeLessThan(detailsIdx)
  })

  // ---- Header ----

  it('includes issue title, URL, repo, and complexity in header', () => {
    const result = brief()
    expect(result).toContain('# Task: Add support for async hooks')
    expect(result).toContain('Issue: https://github.com/fastify/fastify/issues/100')
    expect(result).toContain('Repo: fastify/fastify | Complexity: low')
  })

  // ---- Critical Rules ----

  it('includes critical rules about MCP tools and directives', () => {
    const result = brief()
    expect(result).toContain('DO NOT use GitHub MCP tools to look up issues on other repositories')
    expect(result).toContain(
      'DO NOT add Closes, Fixes, or Resolves directives to your PR or commits'
    )
    expect(result).toContain('Only work within this fork repository')
    expect(result).toContain('Never commit `__pycache__` directories')
  })

  it('includes default branch in critical rules', () => {
    const result = brief()
    expect(result).toContain('Always target the `main` branch')
  })

  // ---- Environment Setup ----

  it('includes language in environment setup', () => {
    const result = brief()
    expect(result).toContain('**Language:** TypeScript')
  })

  it('includes inferred environment hints for TypeScript', () => {
    const result = brief({ meta: { language: 'TypeScript' } })
    expect(result).toContain('`npm install`')
    expect(result).toContain('`npm test`')
  })

  it('includes inferred environment hints for Python', () => {
    const result = brief({ meta: { language: 'Python' } })
    expect(result).toContain('pip install')
    expect(result).toContain('pytest')
  })

  it('includes devEnvironment data when available', () => {
    const result = brief({
      meta: {
        devEnvironment: {
          packageManager: 'pip',
          installCommand: "pip install -e '.[dev]'",
          testRunner: 'pytest',
          testCommand: 'python -m pytest tests/ -v',
          buildCommand: null,
          lintCommand: 'ruff check .',
          knownIssues: ['PySocks==1.6.8 is incompatible with Python 3.12']
        }
      }
    })
    expect(result).toContain("**Install dependencies:** `pip install -e '.[dev]'`")
    expect(result).toContain('**Test runner:** pytest')
    expect(result).toContain('**Run tests:** `python -m pytest tests/ -v`')
    expect(result).toContain('**Lint:** `ruff check .`')
    expect(result).toContain('**Known issue:** PySocks==1.6.8 is incompatible with Python 3.12')
  })

  it('prefers devEnvironment over language inference', () => {
    const result = brief({
      meta: {
        language: 'Python',
        devEnvironment: {
          packageManager: 'pip',
          installCommand: 'pip install -r requirements.txt',
          testRunner: null,
          testCommand: null,
          buildCommand: null,
          lintCommand: null,
          knownIssues: []
        }
      }
    })
    expect(result).toContain('`pip install -r requirements.txt`')
    // Should NOT contain the inferred pytest hint since devEnvironment is provided
    expect(result).not.toContain('likely pytest')
  })

  it('includes hygiene reminder in environment setup', () => {
    const result = brief()
    expect(result).toContain('`__pycache__/`')
    expect(result).toContain('.gitignore')
  })

  // ---- Issue Details ----

  it('includes body preview and labels', () => {
    const result = brief()
    expect(result).toContain('This issue is about adding async hooks support...')
    expect(result).toContain('Labels: good first issue, help wanted')
  })

  it('handles empty labels', () => {
    const result = brief({ issue: { labels: [] } })
    expect(result).not.toContain('Labels:')
  })

  it('handles empty body preview', () => {
    const result = brief({ issue: { bodyPreview: '' } })
    // Should still have the section header but no body text between headers
    expect(result).toContain('## Issue Details')
  })

  // ---- Contribution Rules ----

  it('includes default branch, merge style, and commit convention', () => {
    const result = brief({
      health: {
        prPatterns: {
          ...defaultHealth.prPatterns,
          mergeStyle: 'squash',
          commitConvention: 'conventional'
        }
      }
    })
    expect(result).toContain('Default branch: `main`')
    expect(result).toContain('Merge style: squash')
    expect(result).toContain('Commit convention: conventional')
  })

  it('says "no convention detected" when commitConvention is null', () => {
    const result = brief()
    expect(result).toContain('Commit convention: no convention detected')
  })

  it('includes CONTRIBUTING.md content when available', () => {
    const result = brief({
      meta: { contributingContent: 'Please read our guidelines before contributing.' }
    })
    expect(result).toContain('### CONTRIBUTING.md')
    expect(result).toContain('Please read our guidelines before contributing.')
  })

  it('includes PR template content when available', () => {
    const result = brief({
      meta: { prTemplateContent: '## Description\n## Checklist' }
    })
    expect(result).toContain('### PR Template')
    expect(result).toContain('## Description')
  })

  it('truncates long CONTRIBUTING.md content', () => {
    const longContent = 'A'.repeat(600)
    const result = brief({ meta: { contributingContent: longContent } })
    expect(result).not.toContain(longContent)
    expect(result).toContain('...')
  })

  // ---- PR Patterns ----

  it('includes PR size targets from prPatterns', () => {
    const result = brief()
    expect(result).toContain('Median files changed: 3')
    expect(result).toContain('Median additions: 45')
    expect(result).toContain('Median time to merge: 4.5 days')
    expect(result).toContain('External contributor merge rate: 65%')
  })

  it('includes branch prefixes from merged PRs', () => {
    const merged = [
      makePRSample({ headRefName: 'fix/readme-typo' }),
      makePRSample({ headRefName: 'fix/other-bug', number: 102 }),
      makePRSample({ headRefName: 'feat/new-thing', number: 103 })
    ]
    const result = brief({ merged })
    expect(result).toContain('Common branch prefixes:')
    expect(result).toContain('`fix/`')
    expect(result).toContain('`feat/`')
  })

  // ---- Rejection Patterns ----

  it('includes top rejection reasons', () => {
    const result = brief({
      health: {
        prPatterns: {
          ...defaultHealth.prPatterns,
          topRejectionReasons: ['too large', 'wrong branch']
        }
      }
    })
    expect(result).toContain('- too large')
    expect(result).toContain('- wrong branch')
  })

  it('warns about high rejection rate', () => {
    const merged = [makePRSample()]
    const rejected = [
      makePRSample({ number: 200 }),
      makePRSample({ number: 201 }),
      makePRSample({ number: 202 })
    ]
    const result = brief({ merged, rejected })
    expect(result).toContain('WARNING: High rejection rate (75%)')
  })

  it('warns about large rejected PRs', () => {
    const rejected = [makePRSample({ changedFiles: 25, additions: 600 })]
    const result = brief({ rejected })
    expect(result).toContain('rejected PR(s) were too large')
  })

  it('warns about wrong-branch rejected PRs', () => {
    const result = brief({
      rejected: [makePRSample({ baseRefName: 'develop' })]
    })
    expect(result).toContain('rejected PR(s) targeted non-standard branches')
    expect(result).toContain('Always target `main`')
  })

  it('shows "no rejection patterns" when none exist', () => {
    const result = brief()
    expect(result).toContain('No significant rejection patterns detected.')
  })

  // ---- Quirks & Blockers ----

  it('includes blocker and important quirks', () => {
    const result = brief({
      health: {
        detectedQuirks: [
          {
            type: 'changeset',
            description: 'Changeset file required',
            impact: 'blocker',
            evidence: "Bot says 'missing changeset'"
          },
          {
            type: 'cla',
            description: 'CLA signature required',
            impact: 'important',
            evidence: 'CLA bot active'
          }
        ]
      }
    })
    expect(result).toContain('**BLOCKER:** Changeset file required')
    expect(result).toContain('**IMPORTANT:** CLA signature required')
  })

  it('excludes minor quirks', () => {
    const result = brief({
      health: {
        detectedQuirks: [
          {
            type: 'style',
            description: 'Prefers tabs over spaces',
            impact: 'minor',
            evidence: 'editorconfig'
          }
        ]
      }
    })
    expect(result).not.toContain('Prefers tabs over spaces')
  })

  it('includes external tools warning', () => {
    const result = brief({
      meta: { externalTools: ['CodeRabbit', 'Codecov'] }
    })
    expect(result).toContain('External tools that will review your PR: CodeRabbit, Codecov')
  })

  it('shows "no blockers" when none exist', () => {
    const result = brief()
    expect(result).toContain('No blockers or quirks detected.')
  })

  // ---- Environment ----

  it('includes language and resource availability', () => {
    const result = brief()
    expect(result).toContain('Language: TypeScript')
    expect(result).toContain('CONTRIBUTING.md')
    expect(result).toContain('Code of Conduct')
  })

  it('includes link to CONTRIBUTING.md', () => {
    const result = brief()
    expect(result).toContain(
      '[View CONTRIBUTING.md](https://github.com/fastify/fastify/blob/main/CONTRIBUTING.md)'
    )
  })

  // ---- Selection context NOT included ----

  it('does NOT include CVS score, tier, sentiment, or competition', () => {
    const result = brief({
      issue: {
        cvs: 85,
        cvsTier: 'go',
        sentimentScore: 0.75,
        competitionLevel: 'high',
        contentQualityScore: 90
      }
    })
    // CVS values should not appear in the brief text
    expect(result).not.toMatch(/\bcvs\b/i)
    expect(result).not.toMatch(/\btier\b/i)
    expect(result).not.toMatch(/\bsentiment\b/i)
    expect(result).not.toMatch(/\bcompetition\b/i)
    expect(result).not.toMatch(/\bcontent quality\b/i)
    expect(result).not.toContain('85')
    expect(result).not.toContain('0.75')
    expect(result).not.toContain('90')
  })
})
