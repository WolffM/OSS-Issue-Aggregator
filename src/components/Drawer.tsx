import { useEffect, useRef, type ReactNode, type MouseEvent } from 'react'

interface DrawerProps {
  isOpen: boolean
  onClose: () => void
  title: string
  width?: number
  children: ReactNode
}

export function Drawer({ isOpen, onClose, title, width = 600, children }: DrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div className="drawer-backdrop" onClick={handleBackdropClick}>
      <div
        className="drawer"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        style={{ width: `${width}px`, maxWidth: '100%' }}
      >
        <div className="drawer__header">
          <h2 className="drawer__title">{title}</h2>
          <button className="drawer__close" onClick={onClose} aria-label="Close drawer">
            &times;
          </button>
        </div>
        <div className="drawer__body">{children}</div>
      </div>
    </div>
  )
}
