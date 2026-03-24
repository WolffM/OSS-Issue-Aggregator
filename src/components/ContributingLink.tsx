import type { ReactNode } from 'react'

interface ContributingLinkProps {
  url: string | undefined
  className: string
  children: ReactNode
}

export function ContributingLink({ url, className, children }: ContributingLinkProps) {
  if (!url) return null

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  )
}
