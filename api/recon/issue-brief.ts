/**
 * Issue Brief Formatter
 *
 * Produces a self-contained markdown document with everything a SWE agent
 * needs to work on a specific issue. Only includes execution-relevant context
 * (contribution rules, PR patterns, quirks) — not selection context (CVS, tier, sentiment).
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
  lines.push(`Default branch: \`${meta.defaultBranch}\``)
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

  const reasons = health.prPatterns.topRejectionReasons
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
        `- ${wrongBranch.length} rejected PR(s) targeted non-standard branches. Always target \`${meta.defaultBranch}\`.`
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

  const actionableQuirks = health.detectedQuirks.filter(
    q => q.impact === 'blocker' || q.impact === 'important'
  )
  if (actionableQuirks.length > 0) {
    for (const quirk of actionableQuirks) {
      const prefix = quirk.impact === 'blocker' ? 'BLOCKER' : 'IMPORTANT'
      lines.push(`- **${prefix}:** ${quirk.description} — ${quirk.evidence}`)
    }
    lines.push('')
  }

  if (meta.externalTools.length > 0) {
    lines.push(`External tools that will review your PR: ${meta.externalTools.join(', ')}`)
    lines.push('')
  }

  if (actionableQuirks.length === 0 && meta.externalTools.length === 0) {
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
      `[View CONTRIBUTING.md](https://github.com/${meta.owner}/${meta.repo}/blob/${meta.defaultBranch}/CONTRIBUTING.md)`
    )
  }
  lines.push('')

  return lines.join('\n')
}
