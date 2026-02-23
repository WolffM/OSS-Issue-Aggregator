import { formatRelativeTime } from '../utils/formatDate'

interface FooterProps {
  issueCount: number
  projectCount: number
  lastFetched: Date | null
  errorCount?: number
}

export function Footer({ issueCount, projectCount, lastFetched, errorCount = 0 }: FooterProps) {
  return (
    <footer className="oss-aggregator__footer">
      <div className="footer__stats">
        <span className="footer__stat">
          <strong>{issueCount}</strong> issues
        </span>
        <span className="footer__stat">
          <strong>{projectCount}</strong> projects
        </span>
        {errorCount > 0 && (
          <span className="footer__stat" style={{ color: 'var(--color-warning)' }}>
            <strong>{errorCount}</strong> failed
          </span>
        )}
      </div>
      <div className="footer__timestamp">
        {lastFetched ? `Updated ${formatRelativeTime(lastFetched.toISOString())}` : 'Loading...'}
      </div>
    </footer>
  )
}
