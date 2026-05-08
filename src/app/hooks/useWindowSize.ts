import { useEffect, useState } from 'react'

export interface WindowSize {
  width: number
  height: number
  isMobile: boolean
  isTablet: boolean
}

const MOBILE_BREAKPOINT = 768
const TABLET_BREAKPOINT = 1024

export function useWindowSize(): WindowSize {
  const [windowSize, setWindowSize] = useState<WindowSize>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
    isMobile: typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false,
    isTablet: typeof window !== 'undefined' ? window.innerWidth < TABLET_BREAKPOINT && window.innerWidth >= MOBILE_BREAKPOINT : false,
  }))

  useEffect(() => {
    function handleResize() {
      const width = window.innerWidth
      const height = window.innerHeight
      setWindowSize({
        width,
        height,
        isMobile: width < MOBILE_BREAKPOINT,
        isTablet: width < TABLET_BREAKPOINT && width >= MOBILE_BREAKPOINT,
      })
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return windowSize
}

export const MOBILE_BREAKPOINT_VALUE = MOBILE_BREAKPOINT
