import { Icon } from '@wolffm/themes'

interface ErrorStateProps {
  message: string
  onRetry?: () => void
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="error-state">
      <div className="error-state__icon">
        <Icon name="warning" />
      </div>
      <p className="error-state__message">{message}</p>
      {onRetry && (
        <button className="error-state__retry" onClick={onRetry}>
          Try Again
        </button>
      )}
    </div>
  )
}
