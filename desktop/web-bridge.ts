/**
 * howcode Web Bridge - HTTP server exposing desktop API to remote clients
 * 
 * Run with: bun run desktop/web-bridge.ts
 * 
 * This enables Pi-Mobile to connect to howcode desktop via Tailscale.
 * Should be run alongside the running howcode desktop app.
 */

import { mkdir, open, stat } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import * as piSkills from './pi-skills.ts'
import * as piThreads from './pi-threads.ts'
import * as skillCreator from './skill-creator-session.ts'
import { openPathWithSystem } from './system-open-path.ts'
import * as terminalManager from './terminal/manager.ts'
import packageJson from '../package.json'
import { getAttachmentKind } from '../shared/composer-attachments.ts'
import type {
  DesktopEventMap,
  DesktopRequestChannel,
  DesktopRequestHandlerMap,
} from '../shared/desktop-ipc.ts'
import { getDesktopWorkingDirectory } from '../shared/desktop-working-directory.ts'
import { getSafeExternalUrl } from '../shared/external-url.ts'
import {
  listComposerAttachmentEntries,
  searchComposerAttachmentEntries,
} from '../src/desktop-host/composer-attachments.ts'

const BRIDGE_PORT = 5174
const BRIDGE_HOST = '0.0.0.0'
const bridgeToken = randomUUID()

const desktopEventClients = new Set<http.ServerResponse>()
const terminalEventClients = new Set<http.ServerResponse>()
const sseClients = new Set<http.ServerResponse>()

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

// Subscribe to desktop events
try {
  piThreads.subscribeDesktopEvents((event) => {
    sendSseEvent(desktopEventClients, 'desktopEvent', event)
  })
} catch (e) {
  console.warn('Could not subscribe to desktop events:', e)
}

try {
  terminalManager.subscribeTerminalEvents((event) => {
    sendSseEvent(terminalEventClients, 'terminalEvent', event)
  })
} catch (e) {
  console.warn('Could not subscribe to terminal events:', e)
}

const handlers: DesktopRequestHandlerMap = {
  getAppUpdateState: () => devAppUpdateState,
  checkAppUpdate: () => devAppUpdateState,
  installAppUpdate: () => devAppUpdateState,
  restartAppUpdate: () => devAppUpdateState,
  clearClipboardImages: () => ({ clearedCount: 0, clearFailedCount: 0 }),
  getShellState: () => {
    try {
      return piThreads.loadShellState(getDesktopWorkingDirectory())
    } catch (e) {
      console.error('getShellState failed:', e)
      throw e
    }
  },
  getProjectGitState: ({ projectId }) => piThreads.loadProjectGitState(projectId),
  getProjectDiff: ({ projectId, baseline }) =>
    piThreads.loadProjectDiff(projectId, baseline ?? null),
  getProjectDiffStats: ({ projectId, baseline }) =>
    piThreads.loadProjectDiffStats(projectId, baseline ?? null),
  captureProjectDiffBaseline: ({ projectId }) => piThreads.captureProjectDiffBaseline(projectId),
  listProjectCommits: ({ projectId, limit }) =>
    piThreads.listProjectCommits(projectId, limit ?? null),
  searchPiPackages: (request) => piThreads.searchPiPackages(request),
  getConfiguredPiPackages: (request) => piThreads.listConfiguredPiPackages(request),
  installPiPackage: (request) => piThreads.installPiPackage(request),
  removePiPackage: (request) => piThreads.removePiPackage(request),
  searchPiSkills: (request) => piSkills.searchPiSkills(request),
  getConfiguredPiSkills: (request) => piSkills.listConfiguredPiSkills(request),
  installPiSkill: (request) => piSkills.installPiSkill(request),
  removePiSkill: (request) => piSkills.removePiSkill(request),
  startSkillCreatorSession: (request) => skillCreator.startSkillCreatorSession(request),
  continueSkillCreatorSession: (request) => skillCreator.continueSkillCreatorSession(request),
  closeSkillCreatorSession: (request) => skillCreator.closeSkillCreatorSession(request),
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
  getComposerState: (request) => piThreads.loadComposerState(request),
  getComposerSlashCommands: (request) => piThreads.loadComposerSlashCommands(request),
  getComposerSkills: (request) => piThreads.loadComposerSkills(request),
  getDictationState: () => piThreads.getDictationState(),
  listDictationModels: () => piThreads.listDictationModels(),
  installDictationModel: (request) => piThreads.installDictationModel(request),
  removeDictationModel: (request) => piThreads.removeDictationModel(request),
  transcribeDictation: (request) => piThreads.transcribeDictation(request),
  getProjectThreads: (request) =>
    piThreads.loadProjectThreads(
      request?.projectId ?? '',
      request?.chat === undefined ? {} : { chat: request.chat },
    ),
  getChatSidebarState: (request) =>
    piThreads.loadChatSidebarState(request?.selectedGroupId ?? null),
  createChatGroup: ({ name }) => piThreads.createChatGroup(name),
  listArtifacts: (request) => piThreads.listArtifacts(request?.conversationId ?? null),
  getArtifact: ({ artifactSlug, conversationId }) =>
    piThreads.getArtifact(artifactSlug, conversationId ?? null),
  updateArtifact: ({ artifactSlug, content, conversationId }) =>
    piThreads.updateArtifact({
      slug: artifactSlug,
      content,
      conversationId: conversationId ?? null,
    }),
  editArtifact: ({ artifactSlug, edits, conversationId }) =>
    piThreads.editArtifact({ slug: artifactSlug, edits, conversationId: conversationId ?? null }),
  listArtifactVersions: ({ artifactSlug }) => piThreads.listArtifactVersions(artifactSlug),
  compileReactArtifact: ({ source }) => piThreads.compileReactArtifact(source),
  getInboxThreads: () => piThreads.loadInboxThreadList(),
  getArchivedThreads: () => piThreads.loadArchivedThreadList(),
  getThread: ({ sessionPath, historyCompactions = 0 }) =>
    piThreads.loadThread(sessionPath, { historyCompactions }),
  watchSession: async ({ sessionPath }) => {
    await piThreads.setWatchedSessionPath(sessionPath)
    return { ok: true }
  },
  invokeAction: async ({ action, payload = {} }) => {
    try {
      const result = await piThreads.handleDesktopAction(action, payload)
      return {
        ok: true,
        at: new Date().toISOString(),
        payload: { action, payload },
        result: result ?? null,
      }
    } catch (error) {
      console.error('Web bridge invokeAction failed', { action, payload, error })
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
  listTerminals: () => terminalManager.listTerminals(),
  terminalOpen: (request) => terminalManager.openTerminal(request),
  terminalWrite: async ({ sessionId, data }) => {
    await terminalManager.writeTerminal(sessionId, data)
    return { ok: true }
  },
  terminalResize: async ({ sessionId, cols, rows }) => {
    await terminalManager.resizeTerminal(sessionId, cols, rows)
    return { ok: true }
  },
  terminalClose: async (request) => {
    await terminalManager.closeTerminal(request)
    return { ok: true }
  },
  terminalSessionFileStat: ({ sessionId }) => terminalManager.statSessionFile(sessionId),
  terminalStatus: ({ sessionId }) => terminalManager.getTerminalStatus(sessionId),
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
    console.error('Web bridge request failed', { channel, error })
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

const server = http.createServer((request, response) => {
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
  console.log('Shutting down web bridge...')
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

  server.close(() => process.exit(0))
  server.closeAllConnections()
  setTimeout(() => process.exit(0), 750).unref()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

console.log('')
console.log('╔═══════════════════════════════════════════════════════════════╗')
console.log('║          howcode Web Bridge - Mobile Access Server            ║')
console.log('╠═══════════════════════════════════════════════════════════════╣')
console.log(`║  Status:    Starting...                                       ║`)
console.log(`║  Port:      ${BRIDGE_PORT}                                                ║`)
console.log(`║  Host:      ${BRIDGE_HOST} (all interfaces)                             ║`)
console.log(`║  Token:     ${bridgeToken.slice(0, 8)}...                               ║`)
console.log('╠═══════════════════════════════════════════════════════════════╣')
console.log('║  Mobile Access:                                             ║')
console.log(`║    http://<laptop-ip>:${BRIDGE_PORT}                                  ║`)
console.log(`║    http://pcmaison.tail94f992.ts.net:${BRIDGE_PORT}                     ║`)
console.log('╠═══════════════════════════════════════════════════════════════╣')
console.log('║  To use with Pi-Mobile:                                     ║')
console.log('║    1. Start howcode desktop app                             ║')
console.log('║    2. Open Pi-Mobile on your phone                          ║')
console.log('║    3. Connect to the URL above                              ║')
console.log('╚═══════════════════════════════════════════════════════════════╝')
console.log('')

server.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Web bridge did not expose a numeric port.')
  }

  console.log(`Web bridge listening on http://${BRIDGE_HOST}:${address.port}`)
  console.log('')
})
