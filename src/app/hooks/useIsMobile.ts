import { useWindowSize, MOBILE_BREAKPOINT_VALUE } from './useWindowSize'

export type { WindowSize } from './useWindowSize'

/**
 * Hook to detect if the current viewport is mobile-sized
 */
export function useIsMobile(): boolean {
  const { isMobile } = useWindowSize()
  return isMobile
}

/**
 * Hook to detect if the current viewport is tablet-sized
 */
export function useIsTablet(): boolean {
  const { isTablet } = useWindowSize()
  return isTablet
}

/**
 * Hook to get the current breakpoint
 */
export function useBreakpoint(): 'mobile' | 'tablet' | 'desktop' {
  const { isMobile, isTablet } = useWindowSize()
  if (isMobile) return 'mobile'
  if (isTablet) return 'tablet'
  return 'desktop'
}

export { MOBILE_BREAKPOINT_VALUE }
