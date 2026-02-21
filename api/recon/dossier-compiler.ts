/**
 * Dossier Compiler
 *
 * Compiles repo data into a 6-section markdown dossier.
 * Pure function — takes data, returns Dossier.
 */

import type { RepoMeta, RepoHealth, ScoredIssue, PRSample, Dossier } from './types'

// ============================================================================
// Helpers
// ============================================================================

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '...'
}

function viabilityVerdict(score: number): string {
  if (score >= 70) return 'Viable'
  if (score >= 40) return 'Caution'
  return 'Not Viable'
}

function branchPrefixes(mergedPRs: PRSample[]): string[] {
  const prefixCounts = new Map<string, number>()

  for (const pr of mergedPRs) {
    const match = /^([a-z]+)\//i.exec(pr.headRefName)
    if (match) {
      const prefix = match[1].toLowerCase()
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1)
    }
  }

  return [...prefixCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([prefix, count]) => `\`${prefix}/\` (${count} PRs)`)
}

// ============================================================================
// Section Generators
// ============================================================================

function generateOverview(meta: RepoMeta, health: RepoHealth): string {
  const lines: string[] = ['## Overview', '']

  lines.push(`**${meta.owner}/${meta.repo}**`)
  lines.push('')

  const details = [
    `Stars: ${meta.stars.toLocaleString()}`,
    `Forks: ${meta.forks.toLocaleString()}`,
    meta.language ? `Language: ${meta.language}` : null,
    meta.license ? `License: ${meta.license}` : null
  ].filter(Boolean)
  lines.push(details.join(' | '))
  lines.push('')

  if (health.killed) {
    lines.push(`> **Not Viable** — ${health.killReason}`)
    lines.push('')
  } else {
    const verdict = viabilityVerdict(health.overallViability)
    lines.push(`**Viability: ${verdict}** (score: ${health.overallViability}/100)`)
    lines.push('')
    lines.push('| Metric | Score |')
    lines.push('|---|---|')
    lines.push(`| Maintainer Health | ${health.maintainerHealthScore}/100 |`)
    lines.push(`| Merge Accessibility | ${health.mergeAccessibilityScore}/100 |`)
    lines.push(`| Availability | ${health.availabilityScore}/100 |`)
    lines.push('')
  }

  if (health.detectedQuirks.length > 0) {
    for (const quirk of health.detectedQuirks) {
      lines.push(`> **${quirk.impact.toUpperCase()}:** ${quirk.description} — ${quirk.evidence}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function generateContributionRules(meta: RepoMeta, health: RepoHealth): string {
  const lines: string[] = ['## Contribution Rules', '']

  lines.push(`**Default branch:** \`${meta.defaultBranch}\``)
  lines.push(`**Merge style:** ${health.prPatterns.mergeStyle}`)
  if (health.prPatterns.commitConvention) {
    lines.push(`**Commit convention:** ${health.prPatterns.commitConvention}`)
  }
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

  if (health.detectedQuirks.length > 0) {
    lines.push('### Detected Quirks')
    lines.push('')
    for (const quirk of health.detectedQuirks) {
      lines.push(`- **${quirk.type}** (${quirk.impact}): ${quirk.description}`)
      lines.push(`  Evidence: ${quirk.evidence}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function generateSuccessPatterns(health: RepoHealth, mergedPRs: PRSample[]): string {
  const lines: string[] = ['## Success Patterns', '']
  const p = health.prPatterns

  lines.push('| Metric | Value |')
  lines.push('|---|---|')
  lines.push(`| Median files changed | ${p.medianFilesChanged} |`)
  lines.push(`| Median additions | ${p.medianAdditions} |`)
  lines.push(`| Median time to merge | ${p.medianTimeToMergeDays} days |`)
  lines.push(`| Merge style | ${p.mergeStyle} |`)
  lines.push(
    `| External contributor merge rate | ${Math.round(p.externalContributorMergeRate * 100)}% |`
  )
  lines.push('')

  if (mergedPRs.length > 0) {
    const prefixes = branchPrefixes(mergedPRs)
    if (prefixes.length > 0) {
      lines.push('**Common branch prefixes:** ' + prefixes.join(', '))
      lines.push('')
    }
  }

  return lines.join('\n')
}

function generateAntiPatterns(
  health: RepoHealth,
  mergedPRs: PRSample[],
  rejectedPRs: PRSample[]
): string {
  const lines: string[] = ['## Anti-Patterns', '']

  const reasons = health.prPatterns.topRejectionReasons
  if (reasons.length > 0) {
    lines.push('**Common rejection reasons:**')
    lines.push('')
    for (const reason of reasons) {
      lines.push(`- ${reason}`)
    }
    lines.push('')
  }

  if (rejectedPRs.length > 0) {
    const totalPRs = mergedPRs.length + rejectedPRs.length
    const rejectionRate = Math.round((rejectedPRs.length / totalPRs) * 100)
    if (rejectionRate > 50) {
      lines.push(
        `> **Warning:** High rejection rate (${rejectionRate}%). Review contribution guidelines carefully.`
      )
      lines.push('')
    }

    const largePRs = rejectedPRs.filter(pr => pr.changedFiles > 20 || pr.additions > 500)
    if (largePRs.length > 0) {
      lines.push(`- ${largePRs.length} rejected PR(s) were too large (>20 files or >500 additions)`)
    }

    const wrongBranch = rejectedPRs.filter(
      pr => pr.baseRefName !== 'main' && pr.baseRefName !== 'master'
    )
    if (wrongBranch.length > 0) {
      lines.push(`- ${wrongBranch.length} rejected PR(s) targeted non-standard branches`)
    }
    lines.push('')
  }

  if (reasons.length === 0 && rejectedPRs.length === 0) {
    lines.push('No significant anti-patterns detected.')
    lines.push('')
  }

  return lines.join('\n')
}

function generateIssueBoard(scoredIssues: ScoredIssue[]): string {
  const lines: string[] = ['## Issue Board', '']

  if (scoredIssues.length === 0) {
    lines.push('No scored issues available.')
    lines.push('')
    return lines.join('\n')
  }

  const top = scoredIssues.slice(0, 10)

  lines.push('| # | Title | CVS | Tier | Lifecycle | Complexity | Competition |')
  lines.push('|---|---|---|---|---|---|---|')

  for (let i = 0; i < top.length; i++) {
    const issue = top[i]
    const title = truncate(issue.title, 50)
    lines.push(
      `| ${i + 1} | ${title} | ${issue.cvs} | ${issue.cvsTier} | ${issue.lifecycleStage} | ${issue.complexity} | ${issue.competitionLevel} |`
    )
  }
  lines.push('')

  return lines.join('\n')
}

function generateEnvironmentSetup(meta: RepoMeta): string {
  const lines: string[] = ['## Environment Setup', '']

  if (meta.language) {
    lines.push(`**Language:** ${meta.language}`)
  }

  if (meta.topics.length > 0) {
    lines.push(`**Topics:** ${meta.topics.join(', ')}`)
  }

  if (meta.externalTools.length > 0) {
    lines.push(`**External tools:** ${meta.externalTools.join(', ')}`)
  }

  lines.push('')
  lines.push('| Resource | Available |')
  lines.push('|---|---|')
  lines.push(`| CONTRIBUTING.md | ${meta.hasContributing ? 'Yes' : 'No'} |`)
  lines.push(`| PR Template | ${meta.hasPrTemplate ? 'Yes' : 'No'} |`)
  lines.push(`| Code of Conduct | ${meta.hasCodeOfConduct ? 'Yes' : 'No'} |`)
  lines.push(`| CODEOWNERS | ${meta.hasCodeowners ? 'Yes' : 'No'} |`)
  lines.push('')

  if (meta.hasContributing) {
    lines.push(
      `[View CONTRIBUTING.md](https://github.com/${meta.owner}/${meta.repo}/blob/${meta.defaultBranch}/CONTRIBUTING.md)`
    )
    lines.push('')
  }

  return lines.join('\n')
}

// ============================================================================
// Main Compiler
// ============================================================================

export function compileDossier(
  slug: string,
  meta: RepoMeta,
  health: RepoHealth,
  scoredIssues: ScoredIssue[],
  mergedPRs: PRSample[],
  rejectedPRs: PRSample[]
): Dossier {
  return {
    slug,
    generatedAt: new Date().toISOString(),
    sections: {
      overview: generateOverview(meta, health),
      contributionRules: generateContributionRules(meta, health),
      successPatterns: generateSuccessPatterns(health, mergedPRs),
      antiPatterns: generateAntiPatterns(health, mergedPRs, rejectedPRs),
      issueBoard: generateIssueBoard(scoredIssues),
      environmentSetup: generateEnvironmentSetup(meta)
    }
  }
}
