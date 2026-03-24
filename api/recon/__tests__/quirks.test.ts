import { describe, it, expect } from 'vitest'
import { detectQuirks } from '../quirks'
import { makeRepoMeta, makePRSample } from './helpers'

describe('detectQuirks', () => {
  it('returns empty array for vanilla repo', () => {
    const meta = makeRepoMeta()
    const result = detectQuirks(meta, [], [])
    expect(result).toEqual([])
  })

  describe('changeset-required', () => {
    it('detects from contributingContent', () => {
      const meta = makeRepoMeta({
        contributingContent: 'Please include a changeset with your PR.'
      })
      const result = detectQuirks(meta, [], [])
      const quirk = result.find(q => q.type === 'changeset-required')
      expect(quirk).toBeDefined()
      expect(quirk!.impact).toBe('blocker')
      expect(quirk!.evidence).toContain('CONTRIBUTING.md')
    })

    it('detects from PR labels', () => {
      const meta = makeRepoMeta()
      const prs = [makePRSample({ labels: ['changeset-missing'] })]
      const result = detectQuirks(meta, prs, [])
      const quirk = result.find(q => q.type === 'changeset-required')
      expect(quirk).toBeDefined()
      expect(quirk!.impact).toBe('blocker')
    })
  })

  describe('conventional-commits', () => {
    it('detects "conventional commit" in contributingContent', () => {
      const meta = makeRepoMeta({
        contributingContent: 'We use conventional commit messages.'
      })
      const result = detectQuirks(meta, [], [])
      const quirk = result.find(q => q.type === 'conventional-commits')
      expect(quirk).toBeDefined()
      expect(quirk!.impact).toBe('important')
    })

    it('detects "commitlint" in contributingContent', () => {
      const meta = makeRepoMeta({
        contributingContent: 'Commits are validated with commitlint.'
      })
      const result = detectQuirks(meta, [], [])
      const quirk = result.find(q => q.type === 'conventional-commits')
      expect(quirk).toBeDefined()
    })
  })

  describe('cla-required', () => {
    it('detects CLA mention', () => {
      const meta = makeRepoMeta({
        contributingContent: 'You must sign the CLA before contributing.'
      })
      const result = detectQuirks(meta, [], [])
      const quirk = result.find(q => q.type === 'cla-required')
      expect(quirk).toBeDefined()
      expect(quirk!.impact).toBe('blocker')
    })

    it('detects signed-off-by / DCO', () => {
      const meta = makeRepoMeta({
        contributingContent: 'All commits must include a signed-off-by line (DCO).'
      })
      const result = detectQuirks(meta, [], [])
      const quirk = result.find(q => q.type === 'cla-required')
      expect(quirk).toBeDefined()
      expect(quirk!.evidence).toContain('signed-off-by')
    })

    it('detects Contributor License Agreement', () => {
      const meta = makeRepoMeta({
        contributingContent: 'Please sign the Contributor License Agreement.'
      })
      const result = detectQuirks(meta, [], [])
      const quirk = result.find(q => q.type === 'cla-required')
      expect(quirk).toBeDefined()
    })
  })

  describe('branch-target', () => {
    it('detects from contributingContent mentioning develop', () => {
      const meta = makeRepoMeta({
        contributingContent: 'Please target the develop branch for PRs.'
      })
      const result = detectQuirks(meta, [], [])
      const quirk = result.find(q => q.type === 'branch-target')
      expect(quirk).toBeDefined()
      expect(quirk!.impact).toBe('important')
      expect(quirk!.detectedBranch).toBe('develop')
    })

    it('detects from merged PRs targeting non-default branch', () => {
      const meta = makeRepoMeta({ defaultBranch: 'main' })
      const prs = [
        makePRSample({ number: 1, baseRefName: 'develop' }),
        makePRSample({ number: 2, baseRefName: 'develop' }),
        makePRSample({ number: 3, baseRefName: 'main' })
      ]
      const result = detectQuirks(meta, prs, [])
      const quirk = result.find(q => q.type === 'branch-target')
      expect(quirk).toBeDefined()
      expect(quirk!.evidence).toContain('develop')
      expect(quirk!.evidence).toContain('67%')
      expect(quirk!.detectedBranch).toBe('develop')
    })

    it('does not trigger when <30% target non-default', () => {
      const meta = makeRepoMeta({ defaultBranch: 'main' })
      const prs = [
        makePRSample({ number: 1, baseRefName: 'main' }),
        makePRSample({ number: 2, baseRefName: 'main' }),
        makePRSample({ number: 3, baseRefName: 'main' }),
        makePRSample({ number: 4, baseRefName: 'develop' })
      ]
      const result = detectQuirks(meta, prs, [])
      const quirk = result.find(q => q.type === 'branch-target')
      expect(quirk).toBeUndefined()
    })
  })

  describe('issue-linking', () => {
    it('detects from prTemplateContent', () => {
      const meta = makeRepoMeta({
        hasPrTemplate: true,
        prTemplateContent: '## Related issue\n\nFixes #'
      })
      const result = detectQuirks(meta, [], [])
      const quirk = result.find(q => q.type === 'issue-linking')
      expect(quirk).toBeDefined()
      expect(quirk!.impact).toBe('important')
    })

    it('detects Closes # pattern', () => {
      const meta = makeRepoMeta({
        hasPrTemplate: true,
        prTemplateContent: 'Closes #XXX'
      })
      const result = detectQuirks(meta, [], [])
      expect(result.find(q => q.type === 'issue-linking')).toBeDefined()
    })

    it('skips when prTemplateContent is null', () => {
      const meta = makeRepoMeta({ prTemplateContent: null })
      const result = detectQuirks(meta, [], [])
      expect(result.find(q => q.type === 'issue-linking')).toBeUndefined()
    })
  })

  describe('rfc-required', () => {
    it('detects "open an issue first"', () => {
      const meta = makeRepoMeta({
        contributingContent: 'Please open an issue first before submitting a PR.'
      })
      const result = detectQuirks(meta, [], [])
      const quirk = result.find(q => q.type === 'rfc-required')
      expect(quirk).toBeDefined()
      expect(quirk!.impact).toBe('important')
    })

    it('detects RFC mention', () => {
      const meta = makeRepoMeta({
        contributingContent: 'Large changes require an RFC.'
      })
      const result = detectQuirks(meta, [], [])
      expect(result.find(q => q.type === 'rfc-required')).toBeDefined()
    })
  })

  it('returns multiple quirks when multiple detected', () => {
    const meta = makeRepoMeta({
      contributingContent:
        'Must use changeset. Sign the CLA. Use conventional commit format. Open an issue first.',
      prTemplateContent: 'Fixes #'
    })
    const result = detectQuirks(meta, [], [])
    expect(result.length).toBeGreaterThanOrEqual(4)
    const types = result.map(q => q.type)
    expect(types).toContain('changeset-required')
    expect(types).toContain('cla-required')
    expect(types).toContain('conventional-commits')
    expect(types).toContain('rfc-required')
    expect(types).toContain('issue-linking')
  })

  it('skips content-based detections when contributingContent is null', () => {
    const meta = makeRepoMeta({ contributingContent: null })
    const result = detectQuirks(meta, [], [])
    expect(result).toEqual([])
  })
})
