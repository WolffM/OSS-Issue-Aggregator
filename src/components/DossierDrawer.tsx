import { useState, useEffect, useCallback } from 'react'
import { Drawer } from './Drawer'
import { useDossier } from '../hooks/useDossier'
import type { DossierSections } from '../api/types'

interface DossierDrawerProps {
  slug: string | null
  isOpen: boolean
  onClose: () => void
}

type SectionKey = keyof DossierSections

const SECTION_TABS: { key: SectionKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'contributionRules', label: 'Contribution Rules' },
  { key: 'successPatterns', label: 'Success Patterns' },
  { key: 'antiPatterns', label: 'Anti-Patterns' },
  { key: 'issueBoard', label: 'Issue Board' },
  { key: 'environmentSetup', label: 'Environment' }
]

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {}

let markedParse: ((markdown: string) => string) | null = null

async function loadMarked(): Promise<(markdown: string) => string> {
  if (markedParse) return markedParse
  const { marked } = await import('marked')
  marked.setOptions({ async: false })
  markedParse = (md: string) => marked.parse(md) as string
  return markedParse
}

function formatAgentPrompt(slug: string, sections: DossierSections): string {
  const repo = slug.replace('-', '/')
  return [
    `# Agent Instructions: ${repo}`,
    '',
    `You are working on the repository ${repo}. Follow these instructions carefully.`,
    '',
    '## Repository Overview',
    sections.overview,
    '',
    '## Contribution Rules (MUST FOLLOW)',
    sections.contributionRules,
    '',
    '## Success Patterns (FOLLOW THESE)',
    sections.successPatterns,
    '',
    '## Anti-Patterns (AVOID THESE)',
    sections.antiPatterns,
    '',
    '## Current Issue Board',
    sections.issueBoard,
    '',
    '## Environment Setup',
    sections.environmentSetup
  ].join('\n')
}

function formatFullDossier(sections: DossierSections): string {
  return Object.values(sections).join('\n\n---\n\n')
}

export function DossierDrawer({ slug, isOpen, onClose }: DossierDrawerProps) {
  const { dossier, isPending, isLoading, error } = useDossier(isOpen ? slug : null)
  const [activeTab, setActiveTab] = useState<SectionKey>('overview')
  const [renderedHtml, setRenderedHtml] = useState('')
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)

  // Render markdown when active section changes
  useEffect(() => {
    if (!dossier) {
      setRenderedHtml('')
      return
    }

    const markdown = dossier.sections[activeTab]
    void loadMarked().then(parse => {
      setRenderedHtml(parse(markdown))
    })
  }, [dossier, activeTab])

  // Reset tab when drawer opens with new slug
  useEffect(() => {
    if (isOpen) {
      setActiveTab('overview')
    }
  }, [isOpen, slug])

  const showFeedback = useCallback((msg: string) => {
    setCopyFeedback(msg)
    setTimeout(() => setCopyFeedback(null), 2000)
  }, [])

  const copySection = useCallback(async () => {
    if (!dossier) return
    await navigator.clipboard.writeText(dossier.sections[activeTab])
    showFeedback('Section copied!')
  }, [dossier, activeTab, showFeedback])

  const copyAll = useCallback(async () => {
    if (!dossier) return
    await navigator.clipboard.writeText(formatFullDossier(dossier.sections))
    showFeedback('Full dossier copied!')
  }, [dossier, showFeedback])

  const copyAgentPrompt = useCallback(async () => {
    if (!dossier || !slug) return
    await navigator.clipboard.writeText(formatAgentPrompt(slug, dossier.sections))
    showFeedback('Agent prompt copied!')
  }, [dossier, slug, showFeedback])

  const title = slug ? `Dossier: ${slug.replace('-', '/')}` : 'Dossier'

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title={title} width={640}>
      {isLoading ? (
        <div className="dossier__loading">Loading dossier...</div>
      ) : error ? (
        <div className="dossier__error">{error}</div>
      ) : isPending ? (
        <div className="dossier__pending">
          Awaiting initial scan. Data will appear once the scraper has processed this repository.
        </div>
      ) : dossier ? (
        <div className="dossier">
          <div className="dossier__tabs">
            {SECTION_TABS.map(tab => (
              <button
                key={tab.key}
                type="button"
                className={`dossier__tab ${activeTab === tab.key ? 'dossier__tab--active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="dossier__content" dangerouslySetInnerHTML={{ __html: renderedHtml }} />

          <div className="dossier__actions">
            {copyFeedback && <span className="dossier__feedback">{copyFeedback}</span>}
            <button
              type="button"
              className="dossier__copy-btn"
              onClick={() => {
                copySection().catch(noop)
              }}
            >
              Copy Section
            </button>
            <button
              type="button"
              className="dossier__copy-btn"
              onClick={() => {
                copyAll().catch(noop)
              }}
            >
              Copy All
            </button>
            <button
              type="button"
              className="dossier__agent-prompt-btn"
              onClick={() => {
                copyAgentPrompt().catch(noop)
              }}
            >
              Copy as Agent Prompt
            </button>
          </div>

          {dossier.generatedAt && (
            <div className="dossier__timestamp">
              Generated: {new Date(dossier.generatedAt).toLocaleString()}
            </div>
          )}
        </div>
      ) : null}
    </Drawer>
  )
}
