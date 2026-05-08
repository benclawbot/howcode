import { type PointerEvent, type RefObject, useCallback, useEffect, useState } from 'react'

const DEFAULT_HOVER_TOLERANCE_PX = 20

function isPointInsideRectWithTolerance({
  clientX,
  clientY,
  rect,
  tolerancePx,
}: {
  clientX: number
  clientY: number
  rect: DOMRect
  tolerancePx: number
}) {
  return (
    clientX >= rect.left - tolerancePx &&
    clientX <= rect.right + tolerancePx &&
    clientY >= rect.top - tolerancePx &&
    clientY <= rect.bottom + tolerancePx
  )
}

/**
 * Check if device supports touch (mobile/tablet)
 */
function isTouchDevice(): boolean {
  // Check for touch capability
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    return true
  }
  // Also check window width as fallback
  return window.innerWidth < 768
}

export function useHoverToFocus<T extends HTMLElement>({
  enabled,
  boundaryRef,
  targetRef,
  focus,
  blur,
  blurOnLeave = false,
  tolerancePx = DEFAULT_HOVER_TOLERANCE_PX,
  isFocused,
}: {
  enabled: boolean
  boundaryRef?: RefObject<HTMLElement | null>
  targetRef?: RefObject<T | null>
  focus: () => void
  blur?: () => void
  blurOnLeave?: boolean
  tolerancePx?: number
  isFocused?: () => boolean
}) {
  const [isTouch, setIsTouch] = useState<boolean>(isTouchDevice)

  // Re-check on resize (for responsiveness)
  useEffect(() => {
    function handleResize() {
      setIsTouch(isTouchDevice())
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const ownsFocus = useCallback(() => {
    if (isFocused) {
      return isFocused()
    }

    return !!targetRef?.current && document.activeElement === targetRef.current
  }, [isFocused, targetRef])

  const focusIfNeeded = useCallback(() => {
    if (!ownsFocus()) {
      focus()
    }
  }, [focus, ownsFocus])

  const blurIfNeeded = useCallback(() => {
    if (blurOnLeave && ownsFocus()) {
      blur?.()
    }
  }, [blur, blurOnLeave, ownsFocus])

  useEffect(() => {
    // On touch devices, skip hover-to-focus entirely - always show and enable the input
    if (!enabled || isTouch) {
      return
    }

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      if (event.pointerType !== 'mouse') {
        return
      }

      const boundary = boundaryRef?.current ?? targetRef?.current
      if (!boundary) {
        return
      }

      const inside = isPointInsideRectWithTolerance({
        clientX: event.clientX,
        clientY: event.clientY,
        rect: boundary.getBoundingClientRect(),
        tolerancePx,
      })

      if (inside) {
        focusIfNeeded()
        return
      }

      blurIfNeeded()
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    return () => window.removeEventListener('pointermove', handlePointerMove)
  }, [blurIfNeeded, boundaryRef, enabled, focusIfNeeded, targetRef, tolerancePx, isTouch])

  // On touch devices, always return a no-op handler
  if (isTouch) {
    return useCallback(
      (_event: PointerEvent<HTMLElement>) => {
        // On touch, just focus immediately when tapped
        focusIfNeeded()
      },
      [focusIfNeeded],
    )
  }

  return useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!enabled || event.pointerType !== 'mouse') {
        return
      }

      focusIfNeeded()
    },
    [enabled, focusIfNeeded],
  )
}
