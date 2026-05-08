import { useCallback, useEffect, useState } from 'react'
import type { DesktopAction } from '../desktop/actions'
import { getErrorMessage } from '../desktop/error-messages'
import type { DesktopActionInvoker, DesktopActionResult } from '../desktop/types'

export const desktopBridgeUnavailableMessage =
  'Desktop bridge is unavailable. Make sure howcode desktop is running.'

// Check if we have direct access to desktop bridge (Electron)
export function hasLocalDesktopBridge() {
  return typeof window !== 'undefined' && typeof window.piDesktop?.invokeAction === 'function'
}

// Check if we should use remote bridge (Tailscale)
export function shouldUseRemoteBridge(): boolean {
  if (hasLocalDesktopBridge()) {
    return false
  }
  return localStorage.getItem('pi-mobile-bridge-url') !== null
}

export function getRemoteBridgeUrl(): string | null {
  return localStorage.getItem('pi-mobile-bridge-url')
}

export function getRemoteBridgeToken(): string | null {
  return localStorage.getItem('pi-mobile-bridge-token')
}

export function saveRemoteBridgeInfo(url: string, token: string) {
  localStorage.setItem('pi-mobile-bridge-url', url)
  localStorage.setItem('pi-mobile-bridge-token', token)
}

export function clearRemoteBridgeInfo() {
  localStorage.removeItem('pi-mobile-bridge-url')
  localStorage.removeItem('pi-mobile-bridge-token')
}

// Legacy alias
export function hasDesktopBridge() {
  return hasLocalDesktopBridge()
}

export function useDesktopBridgeAvailable() {
  const [available, setAvailable] = useState(() => {
    if (hasLocalDesktopBridge()) {
      return true
    }
    return Boolean(getRemoteBridgeToken())
  })

  useEffect(() => {
    if (hasLocalDesktopBridge()) {
      setAvailable(true)
      return
    }

    const url = getRemoteBridgeUrl()
    const token = getRemoteBridgeToken()

    if (!url || !token) {
      setAvailable(false)
      return
    }

    let cancelled = false
    setAvailable(false)

    void fetch(`${url}/__howcode/config`, { cache: 'no-store' })
      .then((response) => {
        if (!cancelled) {
          setAvailable(response.ok)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailable(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  return available
}

export async function probeRemoteBridge(url: string): Promise<{ ok: boolean; token?: string }> {
  try {
    const response = await fetch(`${url}/__howcode/config`, { cache: 'no-store' })
    if (!response.ok) {
      return { ok: false }
    }
    const data = await response.json()
    return { ok: true, token: data.bridgeToken }
  } catch {
    return { ok: false }
  }
}

export function useDesktopBridge() {
  const invokeDesktopAction: DesktopActionInvoker = useCallback(
    async (action: DesktopAction, payload = {}): Promise<DesktopActionResult | null> => {
      // Try local bridge first (Electron)
      if (hasLocalDesktopBridge() && window.piDesktop) {
        try {
          return await window.piDesktop.invokeAction(action, payload)
        } catch (error) {
          return {
            ok: false,
            at: new Date().toISOString(),
            payload: { action, payload },
            result: {
              error: getErrorMessage(error, 'Desktop action request failed.'),
            },
          }
        }
      }

      // Try remote bridge (Tailscale)
      const remoteUrl = getRemoteBridgeUrl()
      const remoteToken = getRemoteBridgeToken()

      if (!remoteUrl || !remoteToken) {
        return {
          ok: false,
          at: new Date().toISOString(),
          payload: { action, payload },
          result: {
            error: desktopBridgeUnavailableMessage,
          },
        }
      }

      try {
        const response = await fetch(`${remoteUrl}/__howcode/request/invokeAction`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-howcode-dev-web-bridge-token': remoteToken,
          },
          body: JSON.stringify({ action, payload }),
        })

        if (!response.ok) {
          return {
            ok: false,
            at: new Date().toISOString(),
            payload: { action, payload },
            result: {
              error: `Request failed: ${response.status}`,
            },
          }
        }

        return await response.json()
      } catch (error) {
        return {
          ok: false,
          at: new Date().toISOString(),
          payload: { action, payload },
          result: {
            error: getErrorMessage(error, 'Desktop action request failed.'),
          },
        }
      }
    },
    [],
  )

  return invokeDesktopAction
}
