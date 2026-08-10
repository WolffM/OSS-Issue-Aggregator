/**
 * Crimson-Kitty Recon Endpoints
 *
 * Five new endpoints added for the v3 contribution pipeline:
 *   GET /:slug/contributing       — parsed CONTRIBUTING.md fields
 *   GET /:slug/pr-template        — upstream PR template structure
 *   GET /:slug/issue-templates    — upstream issue templates
 *   GET /:slug/codeowners         — parsed CODEOWNERS file
 *   GET /:slug/labels             — labels filtered by ?prefix=
 *
 * Data sources (in priority order):
 *   1. KV consolidated recon data (contributingContent / prTemplateContent in RepoMeta)
 *   2. Live GitHub API via github-fetcher.ts (for issue templates, codeowners, labels,
 *      and as fallback when KV content is null)
 *
 * All responses follow the existing {success, data, _meta} envelope.
 */

import { type OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  type HonoEnv,
  getErrorMessage,
  requireKV,
  ErrorResponseSchema,
  slugParam
} from './route-helpers'
import { getConsolidatedRecon } from './kv-reader'
import {
  fetchFirstExisting,
  fetchGitHubLabels,
  fetchGitHubFile,
  fetchDirListing,
  slugToOwnerRepo
} from './github-fetcher'
import { ResponseMetaSchema, type PRSample } from './types'

// ============================================================================
// Schemas
// ============================================================================

const ContributingDataSchema = z
  .object({
    ai_policy: z.enum(['banned', 'disclose_required', 'allowed', 'unknown']).openapi({
      description:
        'AI contribution stance: banned (explicit refusal), disclose_required (must declare / read AGENTS.md / label AI PRs), allowed (explicit welcome), or unknown (no signal found).'
    }),
    matched_phrase: z
      .string()
      .nullable()
      .openapi({ description: 'Verbatim phrase that triggered the ai_policy classification' }),
    matched_in: z
      .enum(['contributing'])
      .nullable()
      .openapi({ description: 'Source document where the matched phrase was found' }),
    dco_required: z.boolean().openapi({ description: 'Whether DCO sign-off is required' }),
    license_check_required: z.boolean().openapi({ description: 'Whether a CLA is required' }),
    raw_excerpt: z.string().openapi({ description: 'First ~500 chars of CONTRIBUTING.md' })
  })
  .openapi('ContributingData')

const ContributingResponseSchema = z
  .object({
    success: z.literal(true),
    data: ContributingDataSchema,
    _meta: ResponseMetaSchema
  })
  .openapi('ContributingResponse')

const PrTemplateSectionSchema = z
  .object({
    heading: z.string().openapi({ example: 'Description' }),
    required: z.boolean().openapi({ example: false }),
    placeholder: z.string().nullable().openapi({ example: 'Describe your changes here...' })
  })
  .openapi('PrTemplateSection')

const PrTemplateDataSchema = z
  .object({
    path: z.string().nullable().openapi({ example: '.github/PULL_REQUEST_TEMPLATE.md' }),
    raw_text: z.string().nullable(),
    sections: z.array(PrTemplateSectionSchema),
    front_matter: z.record(z.string(), z.unknown()).nullable()
  })
  .openapi('PrTemplateData')

const PrTemplateResponseSchema = z
  .object({
    success: z.literal(true),
    data: PrTemplateDataSchema,
    _meta: ResponseMetaSchema
  })
  .openapi('PrTemplateResponse')

const IssueTemplateItemSchema = z
  .object({
    name: z.string().openapi({ example: 'Bug Report' }),
    path: z.string().openapi({ example: '.github/ISSUE_TEMPLATE/bug.yml' }),
    format: z.enum(['yaml', 'markdown']).openapi({ example: 'yaml' }),
    required_fields: z
      .array(z.string())
      .openapi({ description: 'Field IDs with validations.required: true (YAML only)' })
  })
  .openapi('IssueTemplateItem')

const IssueTemplatesResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      templates: z.array(IssueTemplateItemSchema)
    }),
    _meta: ResponseMetaSchema
  })
  .openapi('IssueTemplatesResponse')

const CodeownersRuleSchema = z
  .object({
    pattern: z.string().openapi({ example: '*.ts' }),
    owners: z.array(z.string()).openapi({ example: ['@maintainer1'] })
  })
  .openapi('CodeownersRule')

const CodeownersDataSchema = z
  .object({
    path: z.string().nullable().openapi({ example: '.github/CODEOWNERS' }),
    rules: z.array(CodeownersRuleSchema)
  })
  .openapi('CodeownersData')

const CodeownersResponseSchema = z
  .object({
    success: z.literal(true),
    data: CodeownersDataSchema,
    _meta: ResponseMetaSchema
  })
  .openapi('CodeownersResponse')

const LabelItemSchema = z
  .object({
    name: z.string().openapi({ example: 'ai-policy' }),
    color: z.string().openapi({ example: 'e4e669' }),
    description: z.string().nullable().openapi({ example: 'Issues related to AI policy' })
  })
  .openapi('LabelItem')

const LabelsResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      prefix: z.string(),
      labels: z.array(LabelItemSchema)
    }),
    _meta: ResponseMetaSchema
  })
  .openapi('LabelsResponse')

const AgentsMdDataSchema = z
  .object({
    exists: z.boolean().openapi({ description: 'Whether an AGENTS.md was found' }),
    path: z.string().nullable().openapi({ example: 'AGENTS.md' }),
    raw_text: z.string().nullable().openapi({ description: 'Full file content, null if absent' })
  })
  .openapi('AgentsMdData')

const AgentsMdResponseSchema = z
  .object({
    success: z.literal(true),
    data: AgentsMdDataSchema,
    _meta: ResponseMetaSchema
  })
  .openapi('AgentsMdResponse')

const ContributionConventionsDataSchema = z
  .object({
    commit_style: z.enum(['conventional', 'freeform', 'prefix-required']).openapi({
      description:
        'conventional = Conventional Commits (feat/fix/docs:); prefix-required = some other enforced prefix; freeform = no enforced commit-title pattern.'
    }),
    title_prefix_pattern: z.string().nullable().openapi({
      description:
        'Regex (anchored) the commit title or PR title must satisfy when commit_style != "freeform". Null otherwise.'
    }),
    signoff_required: z.boolean().openapi({
      description: 'True when DCO / Signed-off-by / "git commit -s" is required.'
    }),
    body_structure: z.array(z.string()).openapi({
      description:
        'Required PR body section headings, in order, derived from PR template. Empty when none enforced.'
    }),
    references: z.object({
      close_keyword: z
        .enum(['Fixes', 'Closes', 'Resolves'])
        .nullable()
        .openapi({ description: 'Preferred close-issue keyword for the PR' }),
      syntax: z
        .string()
        .nullable()
        .openapi({ example: 'Fixes #N', description: 'Concrete syntax example for consumers' }),
      in_body: z.boolean().openapi({
        description:
          'True when the close keyword is allowed (or expected) in the PR body. False when CONTRIBUTING.md says use commit messages instead.'
      })
    }),
    evidence: z.object({
      source: z.enum(['contributing', 'pr-template', 'merged-commits', 'default']).openapi({
        description: 'Strongest signal driving this classification'
      }),
      raw_excerpt: z.string().openapi({
        description: 'First 500 chars of the source content (or sample of merged-commit titles).'
      })
    })
  })
  .openapi('ContributionConventionsData')

const ContributionConventionsResponseSchema = z
  .object({
    success: z.literal(true),
    data: ContributionConventionsDataSchema,
    _meta: ResponseMetaSchema
  })
  .openapi('ContributionConventionsResponse')

// ============================================================================
// Parsers
// ============================================================================

type AiPolicy = 'banned' | 'disclose_required' | 'allowed' | 'unknown'

// Ordered by strength: banned > disclose_required > allowed. First match wins within a bucket;
// banned-bucket wins over all others so unambiguous refusals are never downgraded.
const BANNED_PATTERNS: RegExp[] = [
  /\bno\s+ai\b/i,
  /\bno\s+llm\b/i,
  /\bno\s+copilot\b/i,
  /\bno\s+chatgpt\b/i,
  /\bno\s+automated\b/i,
  /\bno\s+auto-?generated\b/i,
  /ai[\s-]generated\s+(?:code|content|contributions?)\s+(?:is|are)\s+(?:prohibited|not\s+allowed|banned|not\s+permitted|rejected)/i,
  /(?:will|would|may)\s+close\s+(?:ai|llm|copilot)[\s-]?(?:generated|assisted)?\s*(?:prs|pull\s+requests|contributions)/i,
  /(?:reject|refuse)s?\s+(?:ai|llm|copilot)[\s-]?(?:generated|assisted)/i,
  /(?:prohibit(?:ed)?|ban(?:ned)?)\s+(?:the\s+)?use\s+of\s+(?:ai|llm|copilot|chatgpt)/i
]

const DISCLOSE_REQUIRED_PATTERNS: RegExp[] = [
  /must\s+(?:disclose|declare|mention|flag|label)/i,
  /please\s+(?:disclose|declare|mention|flag|label)/i,
  /disclose\s+(?:the\s+use|that\s+you\s+used|ai\s+use)/i,
  /mention\s+that\s+you\s+used\s+(?:ai|an?\s+llm|copilot|chatgpt)/i,
  /(?:flag|label)\s+(?:ai[\s-]?(?:assisted|generated)|llm)\s+(?:prs|pull\s+requests|contributions)/i,
  // AGENTS.md pointer — TypeScript-style "coding agents must read AGENTS.md first"
  /<!--\s*coding\s+agents[:\s]/i,
  /read\s+agents\.md\s+before\s+writing\s+code/i,
  /(?:see|refer\s+to)\s+agents\.md/i
]

const ALLOWED_PATTERNS: RegExp[] = [
  /ai[\s-]assisted\s+(?:contributions?\s+are\s+welcome|is\s+welcome|are\s+encouraged|are\s+allowed)/i,
  /(?:llm|ai)[\s-]assisted\s+(?:allowed|encouraged|welcome)/i,
  /you\s+may\s+use\s+(?:copilot|chatgpt|ai|an?\s+llm)/i,
  /we\s+(?:accept|welcome)\s+(?:ai|llm|copilot)[\s-]?(?:assisted|generated)/i
]

function firstMatch(patterns: RegExp[], content: string): string | null {
  for (const re of patterns) {
    const m = re.exec(content)
    if (m) return m[0]
  }
  return null
}

/**
 * Parse CONTRIBUTING.md content to detect AI policy, DCO, and CLA requirements.
 */
function parseContributing(content: string): {
  ai_policy: AiPolicy
  dco_required: boolean
  license_check_required: boolean
  matched_phrase: string | null
  matched_in: 'contributing' | null
} {
  let ai_policy: AiPolicy = 'unknown'
  let matched_phrase: string | null = null

  const bannedMatch = firstMatch(BANNED_PATTERNS, content)
  if (bannedMatch) {
    ai_policy = 'banned'
    matched_phrase = bannedMatch
  }

  if (ai_policy === 'unknown') {
    // Semantic check: AI term within 200 chars of negative phrasing — catches
    // hand-written refusals that don't hit the explicit BANNED_PATTERNS.
    const aiTerm =
      /no\s+ai|no\s+llm|no\s+copilot|ai[\s-]generated\s+content|ai-generated|machine[\s-]generated|no\s+chatgpt|no\s+automated/gi
    const negative =
      /not\s+allowed|prohibited|banned|do\s+not|we\s+don'?t\s+accept|rejected|not\s+permitted|will\s+not\s+be\s+accepted/i
    for (const m of content.matchAll(aiTerm)) {
      const start = Math.max(0, m.index - 200)
      const end = Math.min(content.length, m.index + 200)
      if (negative.test(content.slice(start, end))) {
        ai_policy = 'banned'
        matched_phrase = m[0]
        break
      }
    }
  }

  if (ai_policy === 'unknown') {
    const discloseMatch = firstMatch(DISCLOSE_REQUIRED_PATTERNS, content)
    if (discloseMatch) {
      ai_policy = 'disclose_required'
      matched_phrase = discloseMatch
    }
  }

  if (ai_policy === 'unknown') {
    const allowedMatch = firstMatch(ALLOWED_PATTERNS, content)
    if (allowedMatch) {
      ai_policy = 'allowed'
      matched_phrase = allowedMatch
    }
  }

  // DCO
  const dco_required = /signed[\s-]off[\s-]by|developer\s+certificate\s+of\s+origin|\bDCO\b/i.test(
    content
  )

  // CLA — look for CLA being required, not just mentioned
  // "No CLA required" must NOT match. Target: CLA tooling, or the full phrase "Contributor License Agreement".
  const license_check_required =
    /contributor\s+license\s+agreement|cla[\s-]?bot|cla[\s-]?assistant/i.test(content)

  return {
    ai_policy,
    dco_required,
    license_check_required,
    matched_phrase,
    matched_in: matched_phrase ? 'contributing' : null
  }
}

type CommitStyle = 'conventional' | 'freeform' | 'prefix-required'
type CloseKeyword = 'Fixes' | 'Closes' | 'Resolves'
type ConventionsSource = 'contributing' | 'pr-template' | 'merged-commits' | 'default'

interface ContributionConventions {
  commit_style: CommitStyle
  title_prefix_pattern: string | null
  signoff_required: boolean
  body_structure: string[]
  references: {
    close_keyword: CloseKeyword | null
    syntax: string | null
    in_body: boolean
  }
  evidence: {
    source: ConventionsSource
    raw_excerpt: string
  }
}

const CONVENTIONAL_PREFIX_RE =
  /^(?:fix|feat|docs|chore|build|ci|perf|refactor|revert|style|test|wip)(?:\([^)]+\))?!?:\s/i
const CONVENTIONAL_PATTERN_STR =
  '^(fix|feat|docs|chore|build|ci|perf|refactor|revert|style|test)(\\(.+\\))?: .+$'
const JIRA_PREFIX_RE = /^[A-Z][A-Z0-9]+-\d+:?\s/
const JIRA_PATTERN_STR = '^[A-Z][A-Z0-9]+-\\d+:?\\s.+$'

// Match DCO / Signed-off-by signals from any contribution-policy doc. Includes
// "signed off" (verb form found in PR-template checklists) and "git commit -s",
// not just the literal trailer text.
const SIGNOFF_RE =
  /(?:signed?-?off-?by|developer\s+certificate\s+of\s+origin|\bdco\b|git\s+commit\s+(?:-s|--signoff)|\bsigned\s+off\b)/i

/**
 * Parse contribution conventions from CONTRIBUTING.md, PR template, recent
 * merged PR titles, and any extra DCO-related doc the route resolved
 * (CONTRIBUTING.rst, DCO.md, DCO.rst, …). Always returns a complete bundle —
 * falls through to a "freeform / Fixes #N" default when no signal fires.
 */
export function parseContributionConventions(input: {
  contributing: string | null
  prTemplate: string | null
  mergedPrs: PRSample[]
  /** Additional contribution-policy text — e.g. CONTRIBUTING.rst, DCO.md.
   *  Concatenated with `contributing` for signoff/conventional-commits detection. */
  extraPolicyDocs?: string[]
  /** Owner slug — enables an org-level allowlist fallback for DCO when no
   *  textual signal fires (e.g. apache/* always requires DCO sign-off). */
  owner?: string
}): ContributionConventions {
  const { contributing, prTemplate, mergedPrs, extraPolicyDocs = [], owner } = input

  const policyText = [contributing, ...extraPolicyDocs].filter(Boolean).join('\n\n')

  // ---- signoff_required ----
  // Check every available document. PR template often carries the most
  // explicit DCO signal (argoproj-style "[ ] I have signed off all my commits").
  let signoff_required =
    (policyText && SIGNOFF_RE.test(policyText)) ||
    (prTemplate !== null && SIGNOFF_RE.test(prTemplate))

  // Org-level fallback: orgs with an unambiguous org-wide DCO policy whose
  // per-repo CONTRIBUTING files are often redirect stubs (k/k → kubernetes/community)
  // or live in non-default paths (.rst, contributing-docs/) we don't always
  // catch with textual extraction. Stance: "rather false-positive than
  // false-negative" — DCO bot will still gate-check; missing the signal
  // here would silently auto-close PRs from agents that didn't sign off.
  if (!signoff_required && owner) {
    const DCO_REQUIRED_ORGS = new Set([
      'apache',
      'kubernetes',
      'kubernetes-sigs',
      'helm',
      'istio',
      'containerd',
      'etcd-io',
      'cilium',
      'linkerd',
      'flatcar',
      'argoproj',
      'knative',
      'jetstack'
    ])
    if (DCO_REQUIRED_ORGS.has(owner.toLowerCase())) {
      signoff_required = true
    }
  }

  // ---- commit_style + title_prefix_pattern ----
  let commit_style: CommitStyle = 'freeform'
  let title_prefix_pattern: string | null = null
  let source: ConventionsSource = 'default'
  let raw_excerpt = ''

  if (
    contributing &&
    /(?:conventional\s+commits|commit\s+message\s+convention)/i.test(contributing)
  ) {
    commit_style = 'conventional'
    title_prefix_pattern = CONVENTIONAL_PATTERN_STR
    source = 'contributing'
    raw_excerpt = contributing.slice(0, 500)
  }

  // Fall back to merged-commit sampling. Need a meaningful sample size
  // (≥5 merged PRs) before claiming a pattern is enforced.
  if (commit_style === 'freeform' && mergedPrs.length >= 5) {
    const recent = [...mergedPrs]
      .filter(pr => pr.mergedAt)
      .sort((a, b) => (b.mergedAt ?? '').localeCompare(a.mergedAt ?? ''))
      .slice(0, 50)

    if (recent.length >= 5) {
      const conventionalCount = recent.filter(pr => CONVENTIONAL_PREFIX_RE.test(pr.title)).length
      const jiraCount = recent.filter(pr => JIRA_PREFIX_RE.test(pr.title)).length
      const threshold = recent.length * 0.8

      if (conventionalCount >= threshold) {
        commit_style = 'conventional'
        title_prefix_pattern = CONVENTIONAL_PATTERN_STR
        source = 'merged-commits'
        raw_excerpt = recent
          .slice(0, 5)
          .map(pr => pr.title)
          .join('\n')
      } else if (jiraCount >= threshold) {
        commit_style = 'prefix-required'
        title_prefix_pattern = JIRA_PATTERN_STR
        source = 'merged-commits'
        raw_excerpt = recent
          .slice(0, 5)
          .map(pr => pr.title)
          .join('\n')
      }
    }
  }

  // ---- body_structure ----
  const body_structure: string[] = []
  if (prTemplate) {
    const sections = parsePrTemplateSections(prTemplate)
    for (const sec of sections) {
      const cleaned = sec.heading
        .replace(/\*+\s*$/, '')
        .replace(/\s*\(required\)\s*$/i, '')
        .trim()
      if (cleaned) body_structure.push(cleaned)
    }
    if (source === 'default' && body_structure.length > 0) {
      source = 'pr-template'
      raw_excerpt = prTemplate.slice(0, 500)
    }
  }

  // ---- references.close_keyword / syntax / in_body ----
  // Most-frequent keyword across all available docs wins; default to "Fixes".
  // The regex accepts the keyword followed within 30 chars by `#`, which
  // catches real-world template variants:
  //   Closes #123, Fixes #issue_number, Closes [ISSUE #], "* closes: #ISSUE".
  let close_keyword: CloseKeyword = 'Fixes'
  const counts: Record<string, number> = {}
  const KEYWORD_CONTEXT_RE = /\b(Fixes|Closes|Resolves)\b(?=[\s\S]{0,30}#)/gi
  for (const text of [prTemplate, contributing, ...extraPolicyDocs]) {
    if (!text) continue
    for (const m of text.matchAll(KEYWORD_CONTEXT_RE)) {
      const kw = (m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) as CloseKeyword
      counts[kw] = (counts[kw] ?? 0) + 1
    }
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (sorted.length > 0) close_keyword = sorted[0][0] as CloseKeyword
  const syntax = `${close_keyword} #N`

  // in_body: false if any contribution-policy doc says don't put close keyword in body
  let in_body = true
  if (policyText) {
    if (
      /do\s+not\b[^.]{0,80}\b(?:fixes|closes|resolves)\b[^.]{0,80}\bbody\b/i.test(policyText) ||
      /\b(?:fixes|closes|resolves)\b[^.]{0,40}\bnot\b[^.]{0,40}\bin\s+the\s+pr\s+body\b/i.test(
        policyText
      ) ||
      /use\s+(?:the\s+)?commit\s+message\b[^.]{0,80}\b(?:fixes|closes|resolves)\b/i.test(policyText)
    ) {
      in_body = false
    }
  }

  // If we never picked a real source, prefer contributing (raw excerpt) over
  // PR template, over an empty default. This keeps evidence informative even
  // when the only enforcement signals are signoff/close-keyword mentions.
  if (source === 'default') {
    if (contributing) {
      source = 'contributing'
      raw_excerpt = contributing.slice(0, 500)
    } else if (prTemplate) {
      source = 'pr-template'
      raw_excerpt = prTemplate.slice(0, 500)
    }
  }

  return {
    commit_style,
    title_prefix_pattern,
    signoff_required,
    body_structure,
    references: { close_keyword, syntax, in_body },
    evidence: { source, raw_excerpt }
  }
}

/**
 * Parse YAML front-matter from a markdown string.
 * Returns the key-value pairs if a `---` block exists at the top.
 */
function parseFrontMatter(text: string): Record<string, string> | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match) return null
  const fm: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const kv = /^(\w[\w-]*):\s*(.*)$/.exec(line)
    if (kv) fm[kv[1]] = kv[2].trim()
  }
  return Object.keys(fm).length > 0 ? fm : null
}

/**
 * Parse PR template markdown into sections.
 */
function parsePrTemplateSections(
  raw: string
): { heading: string; required: boolean; placeholder: string | null }[] {
  const sections: { heading: string; required: boolean; placeholder: string | null }[] = []
  const lines = raw.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const headingMatch = /^##\s+(.+)$/.exec(line)
    if (!headingMatch) continue

    const heading = headingMatch[1].trim()
    const required = heading.endsWith('*') || /\(required\)\s*$/i.test(heading)

    // Find next non-empty line after heading
    let placeholder: string | null = null
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim()
      if (!next) continue
      if (next.startsWith('##')) break
      // If it looks like a fill-in prompt (not a checkbox, not pure markdown)
      if (!next.startsWith('- [') && !next.startsWith('> ')) {
        placeholder = next.slice(0, 200)
      }
      break
    }

    sections.push({ heading, required, placeholder })
  }

  return sections
}

/**
 * Parse CODEOWNERS file content into rules.
 */
function parseCodeowners(content: string): { pattern: string; owners: string[] }[] {
  const rules: { pattern: string; owners: string[] }[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const parts = trimmed.split(/\s+/)
    const pattern = parts[0]
    const owners = parts.slice(1).filter(p => p.startsWith('@') || p.includes('@'))
    if (pattern && owners.length > 0) {
      rules.push({ pattern, owners })
    }
  }
  return rules
}

/**
 * Parse a YAML issue template to extract required field IDs.
 * This is a simple line-by-line parser — no full YAML library available.
 */
function parseYamlIssueTemplateRequiredFields(content: string): string[] {
  const required: string[] = []
  const lines = content.split('\n')
  let currentId: string | null = null
  let inValidations = false

  for (const line of lines) {
    const trimmed = line.trim()

    // Top-level id field
    const idMatch = /^id:\s*(.+)$/.exec(trimmed)
    if (idMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
      currentId = idMatch[1].trim().replace(/['"]/g, '')
      inValidations = false
      continue
    }

    if (trimmed === 'attributes:') {
      inValidations = false
      continue
    }

    if (trimmed === 'validations:') {
      inValidations = true
      continue
    }

    // Top-level list item (new body field)
    if (/^- type:/.exec(line)) {
      currentId = null
      inValidations = false
      continue
    }

    // id inside a body field block
    if (currentId === null) {
      const bodyIdMatch = /^\s+id:\s*(.+)$/.exec(line)
      if (bodyIdMatch) {
        currentId = bodyIdMatch[1].trim().replace(/['"]/g, '')
        inValidations = false
        continue
      }
    }

    // required: true inside validations
    if (inValidations || /^\s+required:\s*true/.exec(line)) {
      if (trimmed === 'required: true' && currentId) {
        required.push(currentId)
        inValidations = false
      }
    }
  }

  return required
}

/**
 * Extract the template name from YAML front matter.
 */
function extractTemplateName(content: string, path: string): string {
  const nameMatch = /^name:\s*(.+)$/m.exec(content)
  if (nameMatch) return nameMatch[1].trim().replace(/['"]/g, '')
  // Fall back to filename
  const filename = path.split('/').pop() ?? path
  return filename.replace(/\.(yml|yaml|md)$/, '').replace(/[-_]/g, ' ')
}

// ============================================================================
// Owner/Repo resolution helper
// ============================================================================

async function resolveOwnerRepo(
  kv: KVNamespace,
  slug: string
): Promise<{ owner: string; repo: string; scrapedAt: string | null } | null> {
  const consolidated = await getConsolidatedRecon(kv, slug)
  if (consolidated?.repoMeta) {
    return {
      owner: consolidated.repoMeta.owner,
      repo: consolidated.repoMeta.repo,
      scrapedAt: consolidated.scrapedAt
    }
  }
  // Fall back to slug parsing — ambiguous for multi-hyphen slugs but best effort
  const parsed = slugToOwnerRepo(slug)
  if (!parsed) return null
  return { ...parsed, scrapedAt: null }
}

function buildLiveMeta(scrapedAt: string | null) {
  return {
    scraped_at: scrapedAt,
    computed_at: null,
    served_at: new Date().toISOString()
  }
}

// ============================================================================
// Route Registration
// ============================================================================

export function registerCrimsonKittyRoutes(app: OpenAPIHono<HonoEnv>) {
  // -----------------------------------------------------------------------
  // GET /:slug/contributing
  // -----------------------------------------------------------------------
  const contributingRoute = createRoute({
    method: 'get',
    path: '/{slug}/contributing',
    tags: ['Recon - Crimson Kitty'],
    summary: 'Get parsed CONTRIBUTING.md fields',
    description:
      'Returns AI policy, DCO, and CLA signals parsed from CONTRIBUTING.md. ' +
      'Prefers KV-cached content; falls back to live GitHub API fetch.',
    request: { params: slugParam },
    responses: {
      200: {
        description: 'Parsed contributing fields',
        content: { 'application/json': { schema: ContributingResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(contributingRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    try {
      const { slug } = c.req.valid('param')
      const resolved = await resolveOwnerRepo(kv, slug)
      if (!resolved) {
        return c.json(
          { success: false as const, error: `Cannot resolve owner/repo for slug: ${slug}` },
          500
        )
      }
      const { owner, repo, scrapedAt } = resolved

      // Try KV first (contributingContent from RepoMeta)
      const consolidated = await getConsolidatedRecon(kv, slug)
      let content: string | null = consolidated?.repoMeta?.contributingContent ?? null

      // Fall back to live fetch
      if (!content) {
        const fetched = await fetchFirstExisting(
          owner,
          repo,
          ['.github/CONTRIBUTING.md', 'CONTRIBUTING.md', 'docs/CONTRIBUTING.md'],
          c.env.GITHUB_TOKEN
        )
        content = fetched?.content ?? null
      }

      if (!content) {
        // No CONTRIBUTING.md found — return unknown policy
        return c.json(
          {
            success: true as const,
            data: {
              ai_policy: 'unknown' as const,
              matched_phrase: null,
              matched_in: null,
              dco_required: false,
              license_check_required: false,
              raw_excerpt: ''
            },
            _meta: buildLiveMeta(scrapedAt)
          },
          200
        )
      }

      const parsed = parseContributing(content)
      return c.json(
        {
          success: true as const,
          data: {
            ...parsed,
            raw_excerpt: content.slice(0, 500)
          },
          _meta: buildLiveMeta(scrapedAt)
        },
        200
      )
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  // -----------------------------------------------------------------------
  // GET /:slug/pr-template
  // -----------------------------------------------------------------------
  const prTemplateRoute = createRoute({
    method: 'get',
    path: '/{slug}/pr-template',
    tags: ['Recon - Crimson Kitty'],
    summary: 'Get upstream PR template structure',
    description:
      'Returns the PR template headings and front matter. ' +
      'Prefers KV-cached content; falls back to live GitHub API fetch.',
    request: { params: slugParam },
    responses: {
      200: {
        description: 'PR template structure',
        content: { 'application/json': { schema: PrTemplateResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(prTemplateRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    try {
      const { slug } = c.req.valid('param')
      const resolved = await resolveOwnerRepo(kv, slug)
      if (!resolved) {
        return c.json(
          { success: false as const, error: `Cannot resolve owner/repo for slug: ${slug}` },
          500
        )
      }
      const { owner, repo, scrapedAt } = resolved

      const consolidated = await getConsolidatedRecon(kv, slug)
      let raw: string | null = consolidated?.repoMeta?.prTemplateContent ?? null
      let filePath: string | null = null

      if (!raw) {
        const TEMPLATE_PATHS = [
          '.github/PULL_REQUEST_TEMPLATE.md',
          'PULL_REQUEST_TEMPLATE.md',
          'docs/PULL_REQUEST_TEMPLATE.md',
          '.github/pull_request_template.md'
        ]
        const fetched = await fetchFirstExisting(owner, repo, TEMPLATE_PATHS, c.env.GITHUB_TOKEN)
        raw = fetched?.content ?? null
        filePath = fetched?.path ?? null
      } else {
        // Content came from KV — try to find the path from common locations
        filePath = '.github/PULL_REQUEST_TEMPLATE.md'
      }

      if (!raw) {
        return c.json(
          {
            success: true as const,
            data: { path: null, raw_text: null, sections: [], front_matter: null },
            _meta: buildLiveMeta(scrapedAt)
          },
          200
        )
      }

      const sections = parsePrTemplateSections(raw)
      const front_matter = parseFrontMatter(raw)

      return c.json(
        {
          success: true as const,
          data: { path: filePath, raw_text: raw, sections, front_matter },
          _meta: buildLiveMeta(scrapedAt)
        },
        200
      )
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  // -----------------------------------------------------------------------
  // GET /:slug/issue-templates
  // -----------------------------------------------------------------------
  const issueTemplatesRoute = createRoute({
    method: 'get',
    path: '/{slug}/issue-templates',
    tags: ['Recon - Crimson Kitty'],
    summary: 'Get issue templates',
    description:
      'Returns issue templates from .github/ISSUE_TEMPLATE/ with required field IDs for YAML forms. ' +
      'Always fetches live from GitHub (not stored in KV).',
    request: { params: slugParam },
    responses: {
      200: {
        description: 'Issue templates',
        content: { 'application/json': { schema: IssueTemplatesResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(issueTemplatesRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    try {
      const { slug } = c.req.valid('param')
      const resolved = await resolveOwnerRepo(kv, slug)
      if (!resolved) {
        return c.json(
          { success: false as const, error: `Cannot resolve owner/repo for slug: ${slug}` },
          500
        )
      }
      const { owner, repo, scrapedAt } = resolved

      const templatePaths = await fetchDirListing(
        owner,
        repo,
        '.github/ISSUE_TEMPLATE/',
        c.env.GITHUB_TOKEN
      )

      const eligible = templatePaths.filter(p => /\.(yml|yaml|md)$/.test(p))

      const templates = await Promise.all(
        eligible.map(async path => {
          const fetched = await fetchGitHubFile(owner, repo, path, c.env.GITHUB_TOKEN)
          if (!fetched) return null

          // `as const` on each branch, not on the ternary result: without it
          // TypeScript widens to `string`, and the handler stops matching
          // IssueTemplatesResponseSchema, which declares 'yaml' | 'markdown'.
          // The runtime value was always in range — only the TYPE was wrong, so
          // the fix is to preserve the literal rather than widen the schema.
          const isYaml = /\.(yml|yaml)$/.test(path)
          const name = extractTemplateName(fetched.content, path)
          const required_fields = isYaml
            ? parseYamlIssueTemplateRequiredFields(fetched.content)
            : []

          return {
            name,
            path,
            format: isYaml ? ('yaml' as const) : ('markdown' as const),
            required_fields
          }
        })
      )

      const validTemplates = templates.filter((t): t is NonNullable<typeof t> => t !== null)

      return c.json(
        {
          success: true as const,
          data: { templates: validTemplates },
          _meta: buildLiveMeta(scrapedAt)
        },
        200
      )
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  // -----------------------------------------------------------------------
  // GET /:slug/codeowners
  // -----------------------------------------------------------------------
  const codeownersRoute = createRoute({
    method: 'get',
    path: '/{slug}/codeowners',
    tags: ['Recon - Crimson Kitty'],
    summary: 'Get parsed CODEOWNERS file',
    description:
      'Returns ownership rules from CODEOWNERS, .github/CODEOWNERS, or docs/CODEOWNERS. ' +
      'Fetches live from GitHub.',
    request: { params: slugParam },
    responses: {
      200: {
        description: 'CODEOWNERS rules',
        content: { 'application/json': { schema: CodeownersResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(codeownersRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    try {
      const { slug } = c.req.valid('param')
      const resolved = await resolveOwnerRepo(kv, slug)
      if (!resolved) {
        return c.json(
          { success: false as const, error: `Cannot resolve owner/repo for slug: ${slug}` },
          500
        )
      }
      const { owner, repo, scrapedAt } = resolved

      const fetched = await fetchFirstExisting(
        owner,
        repo,
        ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'],
        c.env.GITHUB_TOKEN
      )

      if (!fetched) {
        return c.json(
          {
            success: true as const,
            data: { path: null, rules: [] },
            _meta: buildLiveMeta(scrapedAt)
          },
          200
        )
      }

      const rules = parseCodeowners(fetched.content)
      return c.json(
        {
          success: true as const,
          data: { path: fetched.path, rules },
          _meta: buildLiveMeta(scrapedAt)
        },
        200
      )
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  // -----------------------------------------------------------------------
  // GET /:slug/labels
  // -----------------------------------------------------------------------
  const labelsRoute = createRoute({
    method: 'get',
    path: '/{slug}/labels',
    tags: ['Recon - Crimson Kitty'],
    summary: 'Get repo labels filtered by prefix',
    description:
      'Returns labels whose name starts with the given prefix (case-insensitive). ' +
      'Defaults to prefix="ai" which catches ai-policy, no-ai, ai-generated, automated labels. ' +
      'Pass prefix= (empty string) to return all labels.',
    request: { params: slugParam },
    responses: {
      200: {
        description: 'Matching labels',
        content: { 'application/json': { schema: LabelsResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(labelsRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    try {
      const { slug } = c.req.valid('param')
      const resolved = await resolveOwnerRepo(kv, slug)
      if (!resolved) {
        return c.json(
          { success: false as const, error: `Cannot resolve owner/repo for slug: ${slug}` },
          500
        )
      }
      const { owner, repo, scrapedAt } = resolved

      const url = new URL(c.req.url)
      const prefix = url.searchParams.get('prefix') ?? 'ai'

      const allLabels = await fetchGitHubLabels(owner, repo, c.env.GITHUB_TOKEN)

      const filtered = prefix
        ? allLabels.filter(l => l.name.toLowerCase().startsWith(prefix.toLowerCase()))
        : allLabels

      return c.json(
        {
          success: true as const,
          data: {
            prefix,
            labels: filtered.map(l => ({
              name: l.name,
              color: l.color,
              description: l.description
            }))
          },
          _meta: buildLiveMeta(scrapedAt)
        },
        200
      )
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  // -----------------------------------------------------------------------
  // GET /:slug/agents-md
  // -----------------------------------------------------------------------
  const agentsMdRoute = createRoute({
    method: 'get',
    path: '/{slug}/agents-md',
    tags: ['Recon - Crimson Kitty'],
    summary: 'Get AGENTS.md content for coding-agent directives',
    description:
      'Returns raw AGENTS.md content from repo root, .github/, or docs/. ' +
      'Always fetches live from GitHub (not stored in KV). ' +
      'Used by coding-agent consumers that need directives like "run X before submitting" or "never touch Y/".',
    request: { params: slugParam },
    responses: {
      200: {
        description: 'AGENTS.md content or absence signal',
        content: { 'application/json': { schema: AgentsMdResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(agentsMdRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    try {
      const { slug } = c.req.valid('param')
      const resolved = await resolveOwnerRepo(kv, slug)
      if (!resolved) {
        return c.json(
          { success: false as const, error: `Cannot resolve owner/repo for slug: ${slug}` },
          500
        )
      }
      const { owner, repo, scrapedAt } = resolved

      const fetched = await fetchFirstExisting(
        owner,
        repo,
        ['AGENTS.md', '.github/AGENTS.md', 'docs/AGENTS.md'],
        c.env.GITHUB_TOKEN
      )

      if (!fetched) {
        return c.json(
          {
            success: true as const,
            data: { exists: false, path: null, raw_text: null },
            _meta: buildLiveMeta(scrapedAt)
          },
          200
        )
      }

      return c.json(
        {
          success: true as const,
          data: { exists: true, path: fetched.path, raw_text: fetched.content },
          _meta: buildLiveMeta(scrapedAt)
        },
        200
      )
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  // -----------------------------------------------------------------------
  // GET /:slug/contribution-conventions
  // -----------------------------------------------------------------------
  const conventionsRoute = createRoute({
    method: 'get',
    path: '/{slug}/contribution-conventions',
    tags: ['Recon - Crimson Kitty'],
    summary: 'Get contribution conventions (commit style, signoff, body structure, close keyword)',
    description:
      'Returns the bundle of contribution conventions a downstream consumer needs to format a compliant PR. ' +
      'Derived from CONTRIBUTING.md (signoff, conventional-commits hint, close-keyword rules), ' +
      'PR template (body sections), and merged-commit titles (prefix detection). ' +
      'Always returns a complete bundle — falls through to a freeform / Fixes #N default when no signal fires.',
    request: { params: slugParam },
    responses: {
      200: {
        description: 'Contribution conventions bundle',
        content: { 'application/json': { schema: ContributionConventionsResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(conventionsRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    try {
      const { slug } = c.req.valid('param')
      const resolved = await resolveOwnerRepo(kv, slug)
      if (!resolved) {
        return c.json(
          { success: false as const, error: `Cannot resolve owner/repo for slug: ${slug}` },
          500
        )
      }
      const { owner, repo, scrapedAt } = resolved

      const consolidated = await getConsolidatedRecon(kv, slug)
      let contributing: string | null = consolidated?.repoMeta?.contributingContent ?? null
      let prTemplate: string | null = consolidated?.repoMeta?.prTemplateContent ?? null

      // Live fallback when KV doesn't have the documents — same paths as the
      // existing /contributing and /pr-template endpoints, so this stays
      // consistent with what those return.
      if (!contributing) {
        const fetched = await fetchFirstExisting(
          owner,
          repo,
          ['.github/CONTRIBUTING.md', 'CONTRIBUTING.md', 'docs/CONTRIBUTING.md'],
          c.env.GITHUB_TOKEN
        )
        contributing = fetched?.content ?? null
      }
      if (!prTemplate) {
        const fetched = await fetchFirstExisting(
          owner,
          repo,
          [
            '.github/PULL_REQUEST_TEMPLATE.md',
            'PULL_REQUEST_TEMPLATE.md',
            'docs/PULL_REQUEST_TEMPLATE.md',
            '.github/pull_request_template.md'
          ],
          c.env.GITHUB_TOKEN
        )
        prTemplate = fetched?.content ?? null
      }

      // Extra policy docs the standard fetch paths miss: Apache projects use
      // CONTRIBUTING.rst; many CNCF projects publish a top-level DCO.md/.rst
      // that's the strongest signoff signal when CONTRIBUTING is silent.
      // Fetched in parallel; fetchFirstExisting returns null cleanly per repo.
      const extraPolicyFetches = await Promise.all([
        fetchFirstExisting(
          owner,
          repo,
          ['CONTRIBUTING.rst', '.github/CONTRIBUTING.rst', 'docs/CONTRIBUTING.rst'],
          c.env.GITHUB_TOKEN
        ),
        fetchFirstExisting(
          owner,
          repo,
          ['DCO.md', 'DCO.rst', 'DCO.txt', 'DCO', '.github/DCO.md', '.github/DCO'],
          c.env.GITHUB_TOKEN
        )
      ])
      const extraPolicyDocs = extraPolicyFetches
        .map(f => f?.content)
        .filter((s): s is string => typeof s === 'string')

      const mergedPrs = consolidated?.mergedPrs ?? []
      const data = parseContributionConventions({
        contributing,
        prTemplate,
        mergedPrs,
        extraPolicyDocs,
        owner
      })

      return c.json({ success: true as const, data, _meta: buildLiveMeta(scrapedAt) }, 200)
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })
}
