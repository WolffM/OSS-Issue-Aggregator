interface SentimentIndicatorProps {
  score: number
}

function getSentimentLevel(score: number): 'positive' | 'neutral' | 'negative' {
  if (score > 0.2) return 'positive'
  if (score < -0.2) return 'negative'
  return 'neutral'
}

export function SentimentIndicator({ score }: SentimentIndicatorProps) {
  const level = getSentimentLevel(score)

  return (
    <span
      className={`sentiment-indicator sentiment-indicator--${level}`}
      title={`Sentiment: ${score.toFixed(2)}`}
    >
      <span className="sentiment-indicator__dot" />
    </span>
  )
}
