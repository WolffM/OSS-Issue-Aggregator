import { describe, it, expect } from 'vitest'
import { extractLikelyFiles, detectRelatedIssues } from '../related-issues'
import { makeExtendedIssue } from './helpers'

describe('extractLikelyFiles', () => {
  it('extracts file paths from backtick-quoted code', () => {
    const files = extractLikelyFiles('Fix bug', 'The issue is in `src/hooks.ts` and `lib/utils.py`')
    expect(files).toContain('src/hooks.ts')
    expect(files).toContain('lib/utils.py')
  })

  it('extracts file paths with common directory prefixes', () => {
    const files = extractLikelyFiles('Fix', 'Check src/components/Button.tsx for the issue')
    expect(files).toContain('src/components/Button.tsx')
  })

  it('extracts files mentioned with action verbs', () => {
    const files = extractLikelyFiles('Fix', 'We need to modify `config/settings.json`')
    expect(files).toContain('config/settings.json')
  })

  it('ignores URLs', () => {
    const files = extractLikelyFiles('Fix', 'See `https://example.com/foo.ts`')
    expect(files).toHaveLength(0)
  })

  it('ignores version numbers', () => {
    const files = extractLikelyFiles('Fix', 'Upgrade to `1.2.3`')
    expect(files).toHaveLength(0)
  })

  it('ignores domain names', () => {
    const files = extractLikelyFiles('Fix', 'Check `example.com`')
    expect(files).toHaveLength(0)
  })

  it('returns empty for no file references', () => {
    const files = extractLikelyFiles('Fix bug', 'Something is broken')
    expect(files).toHaveLength(0)
  })

  it('deduplicates results', () => {
    const files = extractLikelyFiles(
      'Fix `src/hooks.ts`',
      'The issue in `src/hooks.ts` needs fixing'
    )
    expect(files.filter(f => f === 'src/hooks.ts')).toHaveLength(1)
  })

  it('returns sorted results', () => {
    const files = extractLikelyFiles('Fix', '`src/z.ts` and `src/a.ts`')
    expect(files).toEqual(['src/a.ts', 'src/z.ts'])
  })
})

describe('detectRelatedIssues', () => {
  it('detects issues referencing the same files', () => {
    const issues = [
      makeExtendedIssue({
        id: 'issue-1',
        title: 'Bug in verifier',
        bodyPreview: 'The `verifier/verifier.py` _can_deliver method is broken'
      }),
      makeExtendedIssue({
        id: 'issue-2',
        title: 'Catch-all detection',
        bodyPreview: 'Fix `verifier/verifier.py` catch-all logic in _can_deliver'
      }),
      makeExtendedIssue({
        id: 'issue-3',
        title: 'Unrelated UI bug',
        bodyPreview: 'The `src/components/Header.tsx` needs fixing'
      })
    ]

    const result = detectRelatedIssues(issues)

    // Issues 1 and 2 should be related (same file)
    const issue1Related = result.get('issue-1')!
    expect(issue1Related.likelyFiles).toContain('verifier/verifier.py')
    expect(issue1Related.relatedIssues.length).toBeGreaterThanOrEqual(1)
    expect(issue1Related.relatedIssues[0].id).toBe('issue-2')

    // Issue 3 should not be related to 1 or 2
    const issue3Related = result.get('issue-3')!
    const relatedIds = issue3Related.relatedIssues.map(r => r.id)
    expect(relatedIds).not.toContain('issue-1')
    expect(relatedIds).not.toContain('issue-2')
  })

  it('populates likelyFiles from issue text', () => {
    const issues = [
      makeExtendedIssue({
        id: 'issue-1',
        title: 'Fix `src/auth.ts`',
        bodyPreview: 'Auth module needs update'
      })
    ]

    const result = detectRelatedIssues(issues)
    expect(result.get('issue-1')!.likelyFiles).toContain('src/auth.ts')
  })

  it('limits related issues to top 5', () => {
    // Create 8 issues with very similar text
    const issues = Array.from({ length: 8 }, (_, i) =>
      makeExtendedIssue({
        id: `issue-${i}`,
        title: `Fix verifier bug variant ${i}`,
        bodyPreview: `The verifier/verifier.py _can_deliver method has bug variant ${i}`
      })
    )

    const result = detectRelatedIssues(issues)
    const firstIssue = result.get('issue-0')!
    expect(firstIssue.relatedIssues.length).toBeLessThanOrEqual(5)
  })

  it('returns empty related for dissimilar issues', () => {
    const issues = [
      makeExtendedIssue({
        id: 'issue-1',
        title: 'Fix authentication',
        bodyPreview: 'The login system is broken in the auth module'
      }),
      makeExtendedIssue({
        id: 'issue-2',
        title: 'Add dark mode',
        bodyPreview: 'We need a theme toggle for the CSS styling system'
      })
    ]

    const result = detectRelatedIssues(issues)
    expect(result.get('issue-1')!.relatedIssues).toHaveLength(0)
    expect(result.get('issue-2')!.relatedIssues).toHaveLength(0)
  })

  it('sorts related issues by similarity descending', () => {
    const issues = [
      makeExtendedIssue({
        id: 'issue-1',
        title: 'Fix verifier',
        bodyPreview: 'Bug in `verifier/verifier.py` _can_deliver method'
      }),
      makeExtendedIssue({
        id: 'issue-2',
        title: 'Update verifier',
        bodyPreview: 'Modify `verifier/verifier.py` _can_deliver catch-all detection'
      }),
      makeExtendedIssue({
        id: 'issue-3',
        title: 'Verifier docs',
        bodyPreview: 'Update verifier documentation for the module'
      })
    ]

    const result = detectRelatedIssues(issues)
    const related = result.get('issue-1')!.relatedIssues
    if (related.length >= 2) {
      expect(related[0].similarity).toBeGreaterThanOrEqual(related[1].similarity)
    }
  })
})
