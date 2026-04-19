/**
 * Related Issue Detection
 *
 * Extracts likely affected files from issue text, then clusters issues
 * by file overlap and text similarity to detect potential merge conflicts.
 *
 * Pure functions — no side effects.
 */

import type { ExtendedIssue, IssueComments, RelatedIssue } from './types'

// ============================================================================
// File Path Extraction
// ============================================================================

/**
 * Extracts likely file paths from issue title + body + any additional text
 * (typically concatenated comment bodies). Looks for common code path patterns
 * in markdown prose and language-specific stack traces.
 */
export function extractLikelyFiles(title: string, body: string, additionalText = ''): string[] {
  const text = additionalText ? `${title}\n${body}\n${additionalText}` : `${title}\n${body}`
  const files = new Set<string>()

  // Match file paths in backticks: `src/foo.ts`
  for (const match of text.matchAll(/`([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)`/g)) {
    if (isLikelyFilePath(match[1])) files.add(match[1])
  }

  // Match file paths in code blocks (lines starting with common path patterns)
  for (const match of text.matchAll(
    /(?:^|\s)((?:src|lib|app|pkg|cmd|internal|test|tests|spec|scripts|bin|config|api|components|pages|utils|helpers|modules|services|models|controllers|routes|middleware|hooks|types|interfaces|schemas|migrations|fixtures|mocks|stubs|vendor|packages|crates|verifier)\/[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)/gm
  )) {
    files.add(match[1])
  }

  // Match standalone filenames with common extensions when mentioned explicitly
  for (const match of text.matchAll(
    /(?:in|file|modify|change|edit|update|fix|patch)\s+`?([a-zA-Z0-9_/-]+\.(?:ts|tsx|js|jsx|py|rs|go|java|rb|php|c|cpp|h|hpp|css|scss|html|yml|yaml|json|toml|cfg|ini))`?/gi
  )) {
    if (isLikelyFilePath(match[1])) files.add(match[1])
  }

  // Stack-trace patterns: Python `File "path/to/file.py"`
  for (const match of text.matchAll(/File\s+"([^"\n]+\.[a-zA-Z0-9]+)"/g)) {
    if (isLikelyFilePath(match[1])) files.add(match[1])
  }

  // Stack-trace patterns: JS/V8 `at fn (src/foo.ts:12:34)` — file:line or file:line:col inside parens
  for (const match of text.matchAll(/\(([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+):\d+(?::\d+)?\)/g)) {
    if (isLikelyFilePath(match[1])) files.add(match[1])
  }

  // Stack-trace patterns: Go/Rust/C-style `path/to/file.ext:line` on its own
  for (const match of text.matchAll(
    /(?:^|\s)([a-zA-Z0-9_./-]+\/[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+):\d+\b/gm
  )) {
    if (isLikelyFilePath(match[1])) files.add(match[1])
  }

  return [...files].sort()
}

function isLikelyFilePath(s: string): boolean {
  // Must contain a dot for extension
  if (!s.includes('.')) return false
  // Must not be a URL
  if (s.includes('://')) return false
  // Must not be a version number like 1.2.3
  if (/^\d+\.\d+/.test(s)) return false
  // Must not be a domain name
  if (/\.(com|org|net|io|dev|ai|co|me)$/.test(s)) return false
  // Must have a reasonable extension
  if (
    !/\.(ts|tsx|js|jsx|py|rs|go|java|rb|php|c|cpp|h|hpp|css|scss|html|yml|yaml|json|toml|cfg|ini|md|txt|sh|bash|zsh|sql|graphql|gql|proto|svelte|vue|astro|ex|exs|erl|hs|ml|scala|kt|swift|m|mm|r|jl|lua|pl|pm|tcl|zig|nim|v|d|f90|f95|cs|fs|vb|dart|groovy|gradle|cmake|make|dockerfile|lock|conf|env|xml|xsl|xsd|wasm|wat)$/i.test(
      s
    )
  )
    return false
  return true
}

// ============================================================================
// Text Similarity (Lightweight Jaccard on token bigrams)
// ============================================================================

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2)
}

function bigrams(tokens: string[]): Set<string> {
  const bg = new Set<string>()
  for (let i = 0; i < tokens.length - 1; i++) {
    bg.add(`${tokens[i]} ${tokens[i + 1]}`)
  }
  return bg
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

// ============================================================================
// Label Overlap
// ============================================================================

function labelOverlap(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const setA = new Set(a.map(l => l.toLowerCase()))
  const setB = new Set(b.map(l => l.toLowerCase()))
  // Exclude generic labels that don't indicate content overlap
  const generic = new Set([
    'good first issue',
    'help wanted',
    'bug',
    'enhancement',
    'feature',
    'documentation',
    'question',
    'hacktoberfest',
    'beginner',
    'easy',
    'starter'
  ])
  const filteredA = new Set([...setA].filter(l => !generic.has(l)))
  const filteredB = new Set([...setB].filter(l => !generic.has(l)))
  if (filteredA.size === 0 && filteredB.size === 0) return 0
  let intersection = 0
  for (const item of filteredA) {
    if (filteredB.has(item)) intersection++
  }
  const union = filteredA.size + filteredB.size - intersection
  return union === 0 ? 0 : intersection / union
}

// ============================================================================
// Related Issue Detection
// ============================================================================

interface IssueFingerprint {
  id: string
  likelyFiles: string[]
  textBigrams: Set<string>
  labels: string[]
}

function fileOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setA = new Set(a)
  let overlap = 0
  for (const f of b) {
    if (setA.has(f)) overlap++
  }
  const union = new Set([...a, ...b]).size
  return union === 0 ? 0 : overlap / union
}

export function detectRelatedIssues(
  issues: ExtendedIssue[],
  comments: IssueComments = {}
): Map<string, { likelyFiles: string[]; relatedIssues: RelatedIssue[] }> {
  // Build fingerprints
  const fingerprints: IssueFingerprint[] = issues.map(issue => {
    const body = issue.body ?? issue.bodyPreview
    const thread = comments[issue.id]
    const commentsText = thread ? thread.comments.map(c => c.body).join('\n') : ''
    const likelyFiles = extractLikelyFiles(issue.title, body, commentsText)
    const tokens = tokenize(`${issue.title} ${body}`)
    return {
      id: issue.id,
      likelyFiles,
      textBigrams: bigrams(tokens),
      labels: issue.labels
    }
  })

  const result = new Map<string, { likelyFiles: string[]; relatedIssues: RelatedIssue[] }>()

  for (let i = 0; i < fingerprints.length; i++) {
    const fp = fingerprints[i]
    const related: RelatedIssue[] = []

    for (let j = 0; j < fingerprints.length; j++) {
      if (i === j) continue
      const other = fingerprints[j]

      // Weighted composite similarity
      const fileSim = fileOverlap(fp.likelyFiles, other.likelyFiles)
      const textSim = jaccardSimilarity(fp.textBigrams, other.textBigrams)
      const labelSim = labelOverlap(fp.labels, other.labels)

      // File overlap is strongest signal, text next, labels weakest
      const composite = fileSim * 0.5 + textSim * 0.35 + labelSim * 0.15

      if (composite >= 0.3) {
        const reasons: string[] = []
        if (fileSim > 0) {
          const shared = fp.likelyFiles.filter(f => other.likelyFiles.includes(f))
          reasons.push(`Both reference ${shared.join(', ')}`)
        }
        if (textSim > 0.3) reasons.push('Similar issue description')
        if (labelSim > 0) reasons.push('Shared component labels')

        related.push({
          id: other.id,
          similarity: Math.round(composite * 100) / 100,
          reason: reasons.join('; ') || 'Content overlap detected'
        })
      }
    }

    // Sort by similarity descending, take top 5
    related.sort((a, b) => b.similarity - a.similarity)

    result.set(fp.id, {
      likelyFiles: fp.likelyFiles,
      relatedIssues: related.slice(0, 5)
    })
  }

  return result
}
