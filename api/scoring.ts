/**
 * Heuristic scoring system to classify issue difficulty.
 *
 * Uses multiple signals to determine if an issue is beginner/intermediate/advanced:
 * - Maintainer labels (strongest signal)
 * - Keyword analysis on title/body
 * - Scope indicators
 * - Complexity keywords
 */

import type { Difficulty } from './types'

export interface ScoringInput {
  title: string
  body?: string
  labels: string[]
  beginnerLabels: string[]
}

export interface ScoringResult {
  difficulty: Difficulty
  score: number // 0-100, lower = easier
  signals: string[]
}

// Common beginner-friendly label patterns across platforms
const BEGINNER_LABEL_PATTERNS = [
  /good.?first.?issue/i,
  /beginner/i,
  /easy/i,
  /starter/i,
  /newcomer/i,
  /first.?timer/i,
  /low.?hanging/i,
  /help.?wanted/i,
  /junior/i,
  /simple/i
]

const INTERMEDIATE_LABEL_PATTERNS = [/intermediate/i, /medium/i, /moderate/i]

const ADVANCED_LABEL_PATTERNS = [/advanced/i, /hard/i, /difficult/i, /expert/i, /complex/i]

/**
 * Score an issue based on multiple heuristic signals.
 * Returns a difficulty classification with score and matched signals.
 */
export function scoreIssue(input: ScoringInput): ScoringResult {
  let score = 50 // Start neutral
  const signals: string[] = []

  const labelsLower = input.labels.map(l => l.toLowerCase())
  const text = `${input.title} ${input.body || ''}`.toLowerCase()

  // =========================================================================
  // Label-based scoring (strongest signals)
  // =========================================================================

  // Check project-specific beginner labels
  const hasProjectBeginnerLabel = input.beginnerLabels.some(bl =>
    labelsLower.some(l => l.includes(bl.toLowerCase()))
  )
  if (hasProjectBeginnerLabel) {
    score -= 30
    signals.push('project-beginner-label')
  }

  // Check common beginner patterns
  const hasBeginnerPattern = BEGINNER_LABEL_PATTERNS.some(pattern =>
    labelsLower.some(l => pattern.test(l))
  )
  if (hasBeginnerPattern && !hasProjectBeginnerLabel) {
    score -= 25
    signals.push('beginner-label-pattern')
  }

  // Check intermediate patterns
  const hasIntermediatePattern = INTERMEDIATE_LABEL_PATTERNS.some(pattern =>
    labelsLower.some(l => pattern.test(l))
  )
  if (hasIntermediatePattern) {
    score += 10
    signals.push('intermediate-label')
  }

  // Check advanced patterns
  const hasAdvancedPattern = ADVANCED_LABEL_PATTERNS.some(pattern =>
    labelsLower.some(l => pattern.test(l))
  )
  if (hasAdvancedPattern) {
    score += 25
    signals.push('advanced-label')
  }

  // =========================================================================
  // Keyword analysis - Easy indicators
  // =========================================================================

  // Typo/spelling fixes are typically easy
  if (/\b(typo|spelling|grammar|misspell)/i.test(text)) {
    score -= 20
    signals.push('typo-fix')
  }

  // Documentation is usually easier
  if (/\b(doc(s|umentation)?|readme|comment)/i.test(text)) {
    score -= 15
    signals.push('docs')
  }

  // Linting/formatting/style fixes
  if (/\b(lint(ing)?|format(ting)?|style|prettier|eslint)/i.test(text)) {
    score -= 15
    signals.push('style-fix')
  }

  // Simple test additions (but not test failures)
  if (
    /\b(add(ing)?.?test|test.?coverage|unit.?test)/i.test(text) &&
    !/\btest.*(fail|break|flak)/i.test(text)
  ) {
    score -= 10
    signals.push('test-addition')
  }

  // Single file scope indicators
  if (/\b(single.?file|one.?file|in.?\w+\.(ts|js|py|go|rs|c|cpp|java|rb))\b/i.test(text)) {
    score -= 10
    signals.push('single-file')
  }

  // Example/sample code
  if (/\b(example|sample|demo|tutorial)/i.test(text)) {
    score -= 10
    signals.push('example-code')
  }

  // Translation/i18n work
  if (/\b(translat|i18n|l10n|locali[sz])/i.test(text)) {
    score -= 10
    signals.push('translation')
  }

  // =========================================================================
  // Keyword analysis - Hard indicators
  // =========================================================================

  // Refactoring/architecture work
  if (/\b(refactor|restructur|redesign|architect)/i.test(text)) {
    score += 20
    signals.push('refactor')
  }

  // Breaking changes/RFCs
  if (/\b(breaking.?change|RFC|proposal|deprecat)/i.test(text)) {
    score += 25
    signals.push('breaking-change')
  }

  // Security issues
  if (/\b(security|vulnerabilit|CVE|exploit|injection|XSS|CSRF)/i.test(text)) {
    score += 20
    signals.push('security')
  }

  // Performance optimization
  if (/\b(performance|optimi[sz]e|benchmark|profil|slow|fast)/i.test(text)) {
    score += 15
    signals.push('performance')
  }

  // Memory/threading issues
  if (/\b(memory.?leak|thread.?safe|deadlock|race.?condition|concurren)/i.test(text)) {
    score += 25
    signals.push('concurrency')
  }

  // Core/internal changes
  if (/\b(core|internal|engine|kernel|runtime)/i.test(text)) {
    score += 15
    signals.push('core-changes')
  }

  // API design
  if (/\b(API.?design|public.?API|interface.?change)/i.test(text)) {
    score += 15
    signals.push('api-design')
  }

  // Backward compatibility
  if (/\b(backward.?compat|migration|upgrade.?path)/i.test(text)) {
    score += 15
    signals.push('compatibility')
  }

  // =========================================================================
  // Clamp score and map to difficulty
  // =========================================================================

  score = Math.max(0, Math.min(100, score))

  let difficulty: Difficulty
  if (score <= 30) {
    difficulty = 'beginner'
  } else if (score <= 55) {
    difficulty = 'intermediate'
  } else if (score <= 80) {
    difficulty = 'advanced'
  } else {
    difficulty = 'unknown'
  }

  return { difficulty, score, signals }
}
