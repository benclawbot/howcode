#!/usr/bin/env tsx
/**
 * Start Web Bridge - Companion script to run the HTTP bridge alongside howcode
 * 
 * Usage:
 *   bun run start-web-bridge
 *   npx tsx scripts/start-web-bridge.ts
 * 
 * This starts the HTTP bridge on port 5174, allowing Pi-Mobile to connect
 * via Tailscale when howcode desktop is running.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

// The bridge file to run
const bridgePath = path.join(projectRoot, 'desktop', 'web-bridge.ts')

console.log('Starting howcode Web Bridge...')
console.log(`Bridge path: ${bridgePath}`)
console.log('')

const bridgeProcess = spawn(
  'npx',
  ['tsx', bridgePath],
  {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      HOWCODE_REPO_ROOT: projectRoot,
    },
  },
)

bridgeProcess.on('error', (error) => {
  console.error('Failed to start bridge:', error.message)
  console.error('Make sure npx and tsx are available, or use bun:')
  console.error(`  bun run ${path.relative(projectRoot, bridgePath)}`)
})

bridgeProcess.on('close', (code) => {
  console.log(`Bridge exited with code ${code}`)
  process.exit(code ?? 0)
})

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\nShutting down bridge...')
  bridgeProcess.kill('SIGINT')
})
