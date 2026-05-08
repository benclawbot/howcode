import type { ReactNode } from 'react'

type MobileComposerDockProps = {
  children: ReactNode
}

/**
 * Mobile-specific composer dock that positions the composer
 * at the bottom of the screen, full-width.
 * 
 * On desktop, the composer uses a 3-column grid with hover-to-focus.
 * On mobile, we want it always visible at the bottom.
 */
export function MobileComposerDock({ children }: MobileComposerDockProps) {
  return (
    <div
      className="mobile-composer-dock"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        background: 'var(--panel, #1a1a2e)',
        borderTop: '1px solid var(--border, rgba(255,255,255,0.1))',
        padding: '8px 12px',
        paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
      }}
    >
      <div
        style={{
          maxWidth: '800px',
          margin: '0 auto',
        }}
      >
        {children}
      </div>
    </div>
  )
}
