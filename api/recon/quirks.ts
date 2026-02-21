/**
 * Repo Quirk Detector
 *
 * Detects contribution quirks from repo metadata and PR patterns.
 * Pure function — takes data, returns RepoQuirk[].
 */

import type { RepoMeta, PRSample, RepoQuirk } from './types'

// ============================================================================
// Individual Detectors
// ============================================================================

function detectChangeset(meta: RepoMeta, mergedPRs: PRSample[]): RepoQuirk | null {
  if (meta.contributingContent && /changeset/i.test(meta.contributingContent)) {
    return {
      type: 'changeset-required',
      description: 'Changeset file required for PRs',
      impact: 'blocker',
      evidence: "CONTRIBUTING.md mentions 'changeset'"
    }
  }

  const withChangesetLabel = mergedPRs.filter(pr => pr.labels.some(l => /changeset/i.test(l)))
  if (mergedPRs.length > 0 && withChangesetLabel.length > 0) {
    return {
      type: 'changeset-required',
      description: 'Changeset file required for PRs',
      impact: 'blocker',
      evidence: `${withChangesetLabel.length} merged PR(s) have changeset-related labels`
    }
  }

  return null
}

function detectConventionalCommits(meta: RepoMeta): RepoQuirk | null {
  if (!meta.contributingContent) return null

  const content = meta.contributingContent
  if (/conventional\s+commit/i.test(content)) {
    return {
      type: 'conventional-commits',
      description: 'Conventional commit format required',
      impact: 'important',
      evidence: "CONTRIBUTING.md mentions 'conventional commit'"
    }
  }

  if (/commitlint/i.test(content)) {
    return {
      type: 'conventional-commits',
      description: 'Conventional commit format required',
      impact: 'important',
      evidence: "CONTRIBUTING.md mentions 'commitlint'"
    }
  }

  return null
}

function detectCLA(meta: RepoMeta): RepoQuirk | null {
  if (!meta.contributingContent) return null

  const content = meta.contributingContent

  if (/\bCLA\b/.test(content) || /contributor\s+license\s+agreement/i.test(content)) {
    return {
      type: 'cla-required',
      description: 'CLA/DCO signature required',
      impact: 'blocker',
      evidence: "CONTRIBUTING.md mentions 'CLA' or 'Contributor License Agreement'"
    }
  }

  if (/signed-off-by/i.test(content) || /\bDCO\b/.test(content)) {
    return {
      type: 'cla-required',
      description: 'CLA/DCO signature required',
      impact: 'blocker',
      evidence: "CONTRIBUTING.md mentions 'signed-off-by' or 'DCO'"
    }
  }

  return null
}

function detectBranchTarget(meta: RepoMeta, mergedPRs: PRSample[]): RepoQuirk | null {
  if (meta.contributingContent && /\b(develop|dev)\s+branch/i.test(meta.contributingContent)) {
    return {
      type: 'branch-target',
      description: 'PRs must target a specific branch (not default)',
      impact: 'important',
      evidence: "CONTRIBUTING.md mentions 'develop' or 'dev' branch"
    }
  }

  if (mergedPRs.length > 0) {
    const nonDefault = mergedPRs.filter(pr => pr.baseRefName !== meta.defaultBranch)
    const ratio = nonDefault.length / mergedPRs.length
    if (ratio > 0.3) {
      const pct = Math.round(ratio * 100)
      return {
        type: 'branch-target',
        description: 'PRs must target a specific branch (not default)',
        impact: 'important',
        evidence: `${pct}% of merged PRs target '${nonDefault[0].baseRefName}' instead of '${meta.defaultBranch}'`
      }
    }
  }

  return null
}

function detectIssueLinking(meta: RepoMeta): RepoQuirk | null {
  if (!meta.prTemplateContent) return null

  if (/fixes\s+#|related\s+issue|closes\s+#/i.test(meta.prTemplateContent)) {
    return {
      type: 'issue-linking',
      description: 'PRs must reference a related issue',
      impact: 'important',
      evidence: "PR template requires issue linking (e.g., 'Fixes #')"
    }
  }

  return null
}

function detectRFC(meta: RepoMeta): RepoQuirk | null {
  if (!meta.contributingContent) return null

  if (/open\s+an\s+issue\s+first|discuss\s+first|\bRFC\b/i.test(meta.contributingContent)) {
    return {
      type: 'rfc-required',
      description: 'Discussion or RFC required before submitting PRs',
      impact: 'important',
      evidence: 'CONTRIBUTING.md requires discussion before PRs'
    }
  }

  return null
}

// ============================================================================
// Main Detector
// ============================================================================

export function detectQuirks(
  meta: RepoMeta,
  mergedPRs: PRSample[],
  _rejectedPRs: PRSample[]
): RepoQuirk[] {
  const detectors = [
    () => detectChangeset(meta, mergedPRs),
    () => detectConventionalCommits(meta),
    () => detectCLA(meta),
    () => detectBranchTarget(meta, mergedPRs),
    () => detectIssueLinking(meta),
    () => detectRFC(meta)
  ]

  return detectors.map(detect => detect()).filter((quirk): quirk is RepoQuirk => quirk !== null)
}
