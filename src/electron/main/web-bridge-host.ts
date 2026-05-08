/**
 * Web Bridge Host - HTTP server that runs inside the Electron main process
 * 
 * This exposes the desktop API to remote clients via HTTP, enabling Pi-Mobile
 * to connect via Tailscale.
 */

import { mkdir, open, stat } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  DesktopEventMap,
  DesktopRequestChannel,
  DesktopRequestHandlerMap,
} from '../../../../shared/desktop-ipc'
import { getDesktopWorkingDirectory } from '../../../shared/desktop-working-directory'
import { getSafeExternalUrl } from '../../../shared/external-url'
import { listComposerAttachmentEntries, searchComposerAttachmentEntries } from '../../desktop-host/composer-attachments'
import { openPathWithSystem } from '../../../desktop/system-open-path'
import type { DesktopRuntimeModules } from '../runtime/desktop-runtime-contracts'
import packageJson from '../../../../../package.json'

const BRIDGE_PORT = 5174
const BRIDGE_HOST = '0.0.0.0'

export interface WebBridgeHost {
  stop: () => void
  getPort: () => number
  getToken: () => string
}

export function createWebBridgeHost(runtime: DesktopRuntimeModules): WebBridgeHost {
  const bridgeToken = randomUUID()
  const desktopEventClients = new Set<http.ServerResponse>()
  const terminalEventClients = new Set<http.ServerResponse>()
  const sseClients = new Set<http.ServerResponse>()
  let server: http.Server | null = null
  let actualPort = 0

  const devAppUpdateState = {
    status: 'up-to-date' as const,
    currentVersion: packageJson.version,
    latestVersion: packageJson.version,
    error: null,
  }

  function sendSseEvent<TChannel extends keyof DesktopEventMap>(
    clients: Set<http.ServerResponse>,
    channel: TChannel,
    event: DesktopEventMap[TChannel],
  ) {
    const payload = JSON.stringify({ channel, event })
    for (const client of clients) {
      try {
        client.write(`event: ${channel}\n`)
        client.write(`data: ${payload}\n\n`)
      } catch {
        // Client may have disconnected
      }
    }
  }

  // Subscribe to desktop events
  try {
    runtime.piThreads.subscribeDesktopEvents((event) => {
      sendSseEvent(desktopEventClients, 'desktopEvent', event)
    })
  } catch (e) {
    console.warn('[WebBridge] Could not subscribe to desktop events:', e)
  }

  try {
    runtime.terminalManager.subscribeTerminalEvents((event) => {
      sendSseEvent(terminalEventClients, 'terminalEvent', event)
    })
  } catch (e) {
    console.warn('[WebBridge] Could not subscribe to terminal events:', e)
  }

  async function writeUniqueTextFile(directoryPath: string, fileName: string, content: string) {
    const parsed = path.parse(fileName)
    for (let index = 0; index < 100; index += 1) {
      const candidateName = index === 0 ? fileName : `${parsed.name}-${index + 1}${parsed.ext}`
      const candidatePath = path.join(directoryPath, candidateName)
      try {
        const file = await open(candidatePath, 'wx', 0o600)
        try {
          await file.writeFile(content, 'utf8')
        } finally {
          await file.close()
        }
        return candidatePath
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'EEXIST'
        ) {
          continue
        }
        throw error
      }
    }
    throw new Error('Could not find an unused file name in Downloads.')
  }

  function getAttachmentKind(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase()
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']
    const codeExts = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.css', '.html']
    const docExts = ['.pdf', '.doc', '.docx', '.txt', '.rtf']
    
    if (imageExts.includes(ext)) return 'image'
    if (codeExts.includes(ext)) return 'code'
    if (docExts.includes(ext)) return 'document'
    return 'file'
  }

  const handlers: DesktopRequestHandlerMap = {
    getAppUpdateState: () => devAppUpdateState,
    checkAppUpdate: () => devAppUpdateState,
    installAppUpdate: () => devAppUpdateState,
    restartAppUpdate: () => devAppUpdateState,
    clearClipboardImages: () => ({ clearedCount: 0, clearFailedCount: 0 }),
    getShellState: () => {
      try {
        return runtime.piThreads.loadShellState(getDesktopWorkingDirectory())
      } catch (e) {
        console.error('[WebBridge] getShellState failed:', e)
        throw e
      }
    },
    getProjectGitState: ({ projectId }) => runtime.piThreads.loadProjectGitState(projectId),
    getProjectDiff: ({ projectId, baseline }) =>
      runtime.piThreads.loadProjectDiff(projectId, baseline ?? null),
    getProjectDiffStats: ({ projectId, baseline }) =>
      runtime.piThreads.loadProjectDiffStats(projectId, baseline ?? null),
    captureProjectDiffBaseline: ({ projectId }) => runtime.piThreads.captureProjectDiffBaseline(projectId),
    listProjectCommits: ({ projectId, limit }) =>
      runtime.piThreads.listProjectCommits(projectId, limit ?? null),
    searchPiPackages: (request) => runtime.piThreads.searchPiPackages(request),
    getConfiguredPiPackages: (request) => runtime.piThreads.listConfiguredPiPackages(request),
    installPiPackage: (request) => runtime.piThreads.installPiPackage(request),
    removePiPackage: (request) => runtime.piThreads.removePiPackage(request),
    searchPiSkills: (request) => runtime.piSkills.searchPiSkills(request),
    getConfiguredPiSkills: (request) => runtime.piSkills.listConfiguredPiSkills(request),
    installPiSkill: (request) => runtime.piSkills.installPiSkill(request),
    removePiSkill: (request) => runtime.piSkills.removePiSkill(request),
    startSkillCreatorSession: (request) => runtime.skillCreator.startSkillCreatorSession(request),
    continueSkillCreatorSession: (request) => runtime.skillCreator.continueSkillCreatorSession(request),
    closeSkillCreatorSession: (request) => runtime.skillCreator.closeSkillCreatorSession(request),
    pickComposerAttachments: () => [],
    readClipboardSnapshot: () => ({ formats: [], valuesByFormat: {} }),
    readClipboardFilePaths: () => ({ filePaths: [], text: null }),
    readClipboardImage: () => null,
    getAttachmentKindsForPaths: async ({ paths }) => {
      const uniquePaths = [...new Set(Array.isArray(paths) ? paths : [])].filter(
        (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0,
      )
      const entries = await Promise.all(
        uniquePaths.map(async (candidate) => {
          try {
            const stats = await stat(candidate)
            return [
              candidate,
              stats.isDirectory() ? 'directory' : getAttachmentKind(candidate),
            ] as const
          } catch {
            return [candidate, null] as const
          }
        }),
      )
      return Object.fromEntries(entries)
    },
    listComposerAttachmentEntries: (request) => listComposerAttachmentEntries(request),
    searchComposerAttachmentEntries: (request) => searchComposerAttachmentEntries(request),
    getComposerState: (request) => runtime.piThreads.loadComposerState(request),
    getComposerSlashCommands: (request) => runtime.piThreads.loadComposerSlashCommands(request),
    getComposerSkills: (request) => runtime.piThreads.loadComposerSkills(request),
    getDictationState: () => runtime.piThreads.getDictationState(),
    listDictationModels: () => runtime.piThreads.listDictationModels(),
    installDictationModel: (request) => runtime.piThreads.installDictationModel(request),
    removeDictationModel: (request) => runtime.piThreads.removeDictationModel(request),
    transcribeDictation: (request) => runtime.piThreads.transcribeDictation(request),
    getProjectThreads: (request) =>
      runtime.piThreads.loadProjectThreads(
        request?.projectId ?? '',
        request?.chat === undefined ? {} : { chat: request.chat },
      ),
    getChatSidebarState: (request) =>
      runtime.piThreads.loadChatSidebarState(request?.selectedGroupId ?? null),
    createChatGroup: ({ name }) => runtime.piThreads.createChatGroup(name),
    listArtifacts: (request) => runtime.piThreads.listArtifacts(request?.conversationId ?? null),
    getArtifact: ({ artifactSlug, conversationId }) =>
      runtime.piThreads.getArtifact(artifactSlug, conversationId ?? null),
    updateArtifact: ({ artifactSlug, content, conversationId }) =>
      runtime.piThreads.updateArtifact({
        slug: artifactSlug,
        content,
        conversationId: conversationId ?? null,
      }),
    editArtifact: ({ artifactSlug, edits, conversationId }) =>
      runtime.piThreads.editArtifact({ slug: artifactSlug, edits, conversationId: conversationId ?? null }),
    listArtifactVersions: ({ artifactSlug }) => runtime.piThreads.listArtifactVersions(artifactSlug),
    compileReactArtifact: ({ source }) => runtime.piThreads.compileReactArtifact(source),
    getInboxThreads: () => runtime.piThreads.loadInboxThreadList(),
    getArchivedThreads: () => runtime.piThreads.loadArchivedThreadList(),
    getThread: ({ sessionPath, historyCompactions = 0 }) =>
      runtime.piThreads.loadThread(sessionPath, { historyCompactions }),
    watchSession: async ({ sessionPath }) => {
      await runtime.piThreads.setWatchedSessionPath(sessionPath)
      return { ok: true }
    },
    invokeAction: async ({ action, payload = {} }) => {
      try {
        const result = await runtime.piThreads.handleDesktopAction(action, payload)
        return {
          ok: true,
          at: new Date().toISOString(),
          payload: { action, payload },
          result: result ?? null,
        }
      } catch (error) {
        console.error('[WebBridge] invokeAction failed', { action, payload, error })
        return {
          ok: false,
          at: new Date().toISOString(),
          payload: { action, payload },
          result: {
            error: error instanceof Error ? error.message : 'Desktop action failed unexpectedly.',
          },
        }
      }
    },
    listTerminals: () => runtime.terminalManager.listTerminals(),
    terminalOpen: (request) => runtime.terminalManager.openTerminal(request),
    terminalWrite: async ({ sessionId, data }) => {
      await runtime.terminalManager.writeTerminal(sessionId, data)
      return { ok: true }
    },
    terminalResize: async ({ sessionId, cols, rows }) => {
      await runtime.terminalManager.resizeTerminal(sessionId, cols, rows)
      return { ok: true }
    },
    terminalClose: async (request) => {
      await runtime.terminalManager.closeTerminal(request)
      return { ok: true }
    },
    terminalSessionFileStat: ({ sessionId }) => runtime.terminalManager.statSessionFile(sessionId),
    terminalStatus: ({ sessionId }) => runtime.terminalManager.getTerminalStatus(sessionId),
    openExternal: async ({ url }) => {
      const safeUrl = getSafeExternalUrl(url)
      return { ok: Boolean(safeUrl && (await openPathWithSystem(safeUrl))) }
    },
    openPath: async ({ path: targetPath }) => ({ ok: await openPathWithSystem(targetPath) }),
    saveTextToDownloads: async ({ fileName, content }) => {
      const safeFileName = fileName
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/^\.+/, '')
        .trim()
      if (!safeFileName) return { ok: false, error: 'Invalid file name.' }
      const downloadsPath = path.join(os.homedir(), 'Downloads')
      try {
        await mkdir(downloadsPath, { recursive: true })
        const filePath = await writeUniqueTextFile(downloadsPath, safeFileName, content)
        return { ok: true, path: filePath }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  }

  async function readJsonBody(request: http.IncomingMessage) {
    const chunks: Buffer[] = []
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }

    if (chunks.length === 0) {
      return {}
    }

    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  }

  function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown) {
    response.statusCode = statusCode
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    response.setHeader('access-control-allow-headers', 'content-type, x-howcode-dev-web-bridge-token')
    response.end(JSON.stringify(payload))
  }

  function hasValidBridgeToken(request: http.IncomingMessage) {
    const token = request.headers['x-howcode-dev-web-bridge-token']
    return typeof token === 'string' && token === bridgeToken
  }

  async function handleBridgeRequest(
    channel: DesktopRequestChannel,
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) {
    const handler = handlers[channel]
    if (!handler) {
      sendJson(response, 404, { error: `Unknown desktop request channel: ${channel}` })
      return
    }

    try {
      const params = await readJsonBody(request)
      const result = await (handler as (params: unknown) => Promise<unknown> | unknown)(params)
      sendJson(response, 200, result ?? null)
    } catch (error) {
      console.error('[WebBridge] Request failed', { channel, error })
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'Desktop bridge request failed.',
      })
    }
  }

  function handleBridgeEvents(
    channel: 'desktopEvent' | 'terminalEvent',
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'access-control-allow-origin': '*',
    })
    response.write('retry: 1000\n\n')

    const clients = channel === 'terminalEvent' ? terminalEventClients : desktopEventClients
    clients.add(response)
    sseClients.add(response)

    request.on('close', () => {
      clients.delete(response)
      sseClients.delete(response)
    })
  }

  server = http.createServer((request, response) => {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      response.writeHead(200, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, x-howcode-dev-web-bridge-token',
      })
      response.end()
      return
    }

    // Auth check (skip for config endpoint)
    const requestUrl = new URL(request.url ?? '/', `http://localhost`)

    if (requestUrl.pathname !== '/__howcode/config' && !hasValidBridgeToken(request)) {
      sendJson(response, 403, { error: 'Invalid bridge token.' })
      return
    }

    if (requestUrl.pathname === '/__howcode/config') {
      sendJson(response, 200, { bridgeToken })
      return
    }

    if (requestUrl.pathname.startsWith('/__howcode/events/')) {
      const channel = requestUrl.pathname.slice('/__howcode/events/'.length)
      if (channel !== 'desktopEvent' && channel !== 'terminalEvent') {
        sendJson(response, 404, { error: `Unknown desktop event channel: ${channel}` })
        return
      }

      handleBridgeEvents(channel, request, response)
      return
    }

    if (requestUrl.pathname.startsWith('/__howcode/request/')) {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Desktop bridge requests must use POST.' })
        return
      }

      const channel = requestUrl.pathname.slice('/__howcode/request/'.length)
      void handleBridgeRequest(channel as DesktopRequestChannel, request, response)
      return
    }

    sendJson(response, 404, { error: 'Unknown endpoint.' })
  })

  function shutdown() {
    console.log('[WebBridge] Shutting down...')
    for (const client of sseClients) {
      try {
        client.end()
        client.destroy()
      } catch {
        // Ignore
      }
    }
    sseClients.clear()
    desktopEventClients.clear()
    terminalEventClients.clear()

    if (server) {
      server.close(() => {})
      server.closeAllConnections()
    }
  }

  // Start the server
  server.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
    const address = server!.address()
    if (address && typeof address === 'object') {
      actualPort = address.port
    }
    console.log('[WebBridge] howcode Web Bridge - Mobile Access Server')
    console.log(`[WebBridge] Status: Running on port ${actualPort}`)
    console.log(`[WebBridge] Host: ${BRIDGE_HOST} (all interfaces)`)
    console.log(`[WebBridge] Token: ${bridgeToken.slice(0, 8)}...`)
    console.log('[WebBridge] Mobile Access:')
    console.log(`[WebBridge]   http://<laptop-ip>:${actualPort}`)
    console.log(`[WebBridge]   http://pcmainen.tail94f992.ts.net:${actualPort}`)
    console.log('[WebBridge] To use with Pi-Mobile:')
    console.log('[WebBridge]   1. Open Pi-Mobile on your phone')
    console.log('[WebBridge]   2. Connect to the URL above')
  })

  return {
    stop: shutdown,
    getPort: () => actualPort,
    getToken: () => bridgeToken,
  }
}
