/**
 * Issue Brief Formatter
 *
 * Produces a self-contained markdown document with everything a SWE agent
 * needs to work on a specific issue. Only includes execution-relevant context
 * (contribution rules, PR patterns, quirks) — not selection context (CVS, tier, sentiment).
 *
 * Section order is intentional: critical rules first (early in context window),
 * then environment setup, then issue details, then patterns/quirks.
 *
 * Pure function — takes data as params, returns markdown string.
 */

import type { ScoredIssue, RepoHealth, RepoMeta, PRSample } from './types'
import { truncate, branchPrefixes } from './dossier-compiler'

export function formatIssueBrief(
  issue: ScoredIssue,
  health: RepoHealth,
  meta: RepoMeta,
  mergedPRs: PRSample[],
  rejectedPRs: PRSample[]
): string {
  const lines: string[] = []
  const repo = `${meta.owner}/${meta.repo}`

  // Header
  lines.push(`# Task: ${issue.title}`)
  lines.push('')
  lines.push(`Issue: ${issue.url}`)
  lines.push(`Repo: ${repo} | Complexity: ${issue.complexity}`)
  lines.push('')

  // Critical Rules — front-loaded so they appear early in the context window
  lines.push('## CRITICAL RULES (Read First)')
  lines.push('')
  lines.push('- DO NOT use GitHub MCP tools to look up issues on other repositories')
  lines.push('- DO NOT add Closes, Fixes, or Resolves directives to your PR or commits')
  lines.push('- Only work within this fork repository')
  lines.push('- Never commit `__pycache__` directories')
  lines.push(`- Always target the \`${meta.defaultBranch ?? 'main'}\` branch`)
  lines.push(`- Merge style: ${health.prPatterns.mergeStyle}`)
  lines.push(
    `- Commit convention: ${health.prPatterns.commitConvention ?? 'no convention detected'}`
  )
  lines.push('')

  // Environment Setup — generated from scraper devEnvironment data
  lines.push('## Environment Setup')
  lines.push('')

  if (meta.language) {
    lines.push(`**Language:** ${meta.language}`)
  }

  const dev = meta.devEnvironment
  if (dev) {
    if (dev.installCommand) {
      lines.push(`- **Install dependencies:** \`${dev.installCommand}\``)
    }
    if (dev.testRunner || dev.testCommand) {
      if (dev.testRunner) {
        lines.push(`- **Test runner:** ${dev.testRunner}`)
      }
      if (dev.testCommand) {
        lines.push(`- **Run tests:** \`${dev.testCommand}\``)
      }
    }
    if (dev.buildCommand) {
      lines.push(`- **Build:** \`${dev.buildCommand}\``)
    }
    if (dev.lintCommand) {
      lines.push(`- **Lint:** \`${dev.lintCommand}\``)
    }
    if (dev.knownIssues.length > 0) {
      for (const ki of dev.knownIssues) {
        lines.push(`- **Known issue:** ${ki}`)
      }
    }
  } else {
    // Infer reasonable defaults from language when scraper hasn't provided devEnvironment
    const inferred = inferEnvironmentHints(meta.language)
    if (inferred.length > 0) {
      for (const hint of inferred) {
        lines.push(`- ${hint}`)
      }
    }
  }

  lines.push(`- **Hygiene:** Add \`__pycache__/\` to \`.gitignore\` before committing`)
  lines.push('')

  // Issue Details
  lines.push('## Issue Details')
  lines.push('')
  if (issue.bodyPreview) {
    lines.push(issue.bodyPreview)
    lines.push('')
  }
  if (issue.labels.length > 0) {
    lines.push(`Labels: ${issue.labels.join(', ')}`)
    lines.push('')
  }

  // Contribution Rules
  lines.push('## Contribution Rules (MUST FOLLOW)')
  lines.push('')
  lines.push(`Default branch: \`${meta.defaultBranch ?? 'main'}\``)
  lines.push(`Merge style: ${health.prPatterns.mergeStyle}`)
  lines.push(`Commit convention: ${health.prPatterns.commitConvention ?? 'no convention detected'}`)
  lines.push('')

  if (meta.contributingContent) {
    lines.push('### CONTRIBUTING.md')
    lines.push('')
    lines.push(truncate(meta.contributingContent, 500))
    lines.push('')
  }

  if (meta.prTemplateContent) {
    lines.push('### PR Template')
    lines.push('')
    lines.push(truncate(meta.prTemplateContent, 300))
    lines.push('')
  }

  // What Gets PRs Merged
  lines.push('## What Gets PRs Merged Here')
  lines.push('')
  const p = health.prPatterns
  lines.push(`- Median files changed: ${p.medianFilesChanged}`)
  lines.push(`- Median additions: ${p.medianAdditions}`)
  lines.push(`- Median time to merge: ${p.medianTimeToMergeDays} days`)
  lines.push(
    `- External contributor merge rate: ${Math.round(p.externalContributorMergeRate * 100)}%`
  )

  if (mergedPRs.length > 0) {
    const prefixes = branchPrefixes(mergedPRs)
    if (prefixes.length > 0) {
      lines.push(`- Common branch prefixes: ${prefixes.join(', ')}`)
    }
  }
  lines.push('')

  // What Gets PRs Rejected
  lines.push('## What Gets PRs Rejected')
  lines.push('')

  const reasons = health.prPatterns.topRejectionReasons ?? []
  if (reasons.length > 0) {
    for (const reason of reasons) {
      lines.push(`- ${reason}`)
    }
  }

  if (rejectedPRs.length > 0) {
    const totalPRs = mergedPRs.length + rejectedPRs.length
    const rejectionRate = Math.round((rejectedPRs.length / totalPRs) * 100)
    if (rejectionRate > 50) {
      lines.push(
        `- WARNING: High rejection rate (${rejectionRate}%). Review contribution guidelines carefully.`
      )
    }

    const largePRs = rejectedPRs.filter(pr => pr.changedFiles > 20 || pr.additions > 500)
    if (largePRs.length > 0) {
      lines.push(
        `- ${largePRs.length} rejected PR(s) were too large (>20 files or >500 additions). Keep changes small.`
      )
    }

    const wrongBranch = rejectedPRs.filter(
      pr => pr.baseRefName !== 'main' && pr.baseRefName !== 'master'
    )
    if (wrongBranch.length > 0) {
      lines.push(
        `- ${wrongBranch.length} rejected PR(s) targeted non-standard branches. Always target \`${meta.defaultBranch ?? 'main'}\`.`
      )
    }
  }

  if (reasons.length === 0 && rejectedPRs.length === 0) {
    lines.push('No significant rejection patterns detected.')
  }
  lines.push('')

  // Quirks & Blockers
  lines.push('## Quirks & Blockers')
  lines.push('')

  const actionableQuirks = (health.detectedQuirks ?? []).filter(
    q => q.impact === 'blocker' || q.impact === 'important'
  )
  if (actionableQuirks.length > 0) {
    for (const quirk of actionableQuirks) {
      const prefix = quirk.impact === 'blocker' ? 'BLOCKER' : 'IMPORTANT'
      lines.push(`- **${prefix}:** ${quirk.description} — ${quirk.evidence}`)
    }
    lines.push('')
  }

  const externalTools = meta.externalTools ?? []
  if (externalTools.length > 0) {
    lines.push(`External tools that will review your PR: ${externalTools.join(', ')}`)
    lines.push('')
  }

  if (actionableQuirks.length === 0 && externalTools.length === 0) {
    lines.push('No blockers or quirks detected.')
    lines.push('')
  }

  // Environment
  lines.push('## Environment')
  lines.push('')
  if (meta.language) {
    lines.push(`Language: ${meta.language}`)
  }

  const resources: string[] = []
  if (meta.hasContributing) resources.push('CONTRIBUTING.md')
  if (meta.hasPrTemplate) resources.push('PR template')
  if (meta.hasCodeOfConduct) resources.push('Code of Conduct')
  if (meta.hasCodeowners) resources.push('CODEOWNERS')
  if (resources.length > 0) {
    lines.push(`Available resources: ${resources.join(', ')}`)
  }

  if (meta.hasContributing) {
    lines.push(
      `[View CONTRIBUTING.md](https://github.com/${meta.owner}/${meta.repo}/blob/${meta.defaultBranch ?? 'main'}/CONTRIBUTING.md)`
    )
  }
  lines.push('')

  return lines.join('\n')
}

// ============================================================================
// Environment Inference
// ============================================================================

/**
 * When devEnvironment is not provided by the scraper, infer reasonable
 * setup hints from the repo's primary language.
 */
function inferEnvironmentHints(language: string | null): string[] {
  if (!language) return []

  const hints: string[] = []
  const lang = language.toLowerCase()

  switch (lang) {
    case 'python':
      hints.push(
        'Install dependencies: `pip install -e ".[dev]"` or `pip install -r requirements.txt`'
      )
      hints.push('Test runner: likely pytest — run `python -m pytest tests/ -v`')
      break
    case 'typescript':
    case 'javascript':
      hints.push(
        'Install dependencies: `npm install` (or check for `yarn.lock` / `pnpm-lock.yaml`)'
      )
      hints.push('Run tests: `npm test`')
      break
    case 'rust':
      hints.push('Build: `cargo build`')
      hints.push('Run tests: `cargo test`')
      break
    case 'go':
      hints.push('Run tests: `go test ./...`')
      break
    case 'java':
    case 'kotlin':
      hints.push('Build: check for `gradlew` or `mvnw` wrapper scripts')
      hints.push('Run tests: `./gradlew test` or `./mvnw test`')
      break
    case 'ruby':
      hints.push('Install dependencies: `bundle install`')
      hints.push('Run tests: `bundle exec rspec` or `bundle exec rake test`')
      break
    case 'c#':
    case 'f#':
      hints.push('Build: `dotnet build`')
      hints.push('Run tests: `dotnet test`')
      break
  }

  return hints
}
