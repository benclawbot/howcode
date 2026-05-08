/**
 * MobileWorkspaceView - A mobile-optimized wrapper for the chat workspace
 * 
 * This component provides:
 * - Always-visible composer at bottom (no hover-to-focus)
 * - Full-width chat input
 * - Visible footer with TUI, Terminal, Git buttons
 * - Proper touch handling
 */
import { useCallback, useRef, useState } from 'react'
import { ChatWorkspaceView } from '../../../features/chat/chat-workspace-view'
import type { AppShellController } from '../../../app-shell/useAppShellController'
import type { AppSettings, ProjectDiffBaseline, ProjectDiffRenderMode } from '../../../desktop/types'

type MobileWorkspaceViewProps = {
  controller: AppShellController
  activeComposerState: AppShellController['activeComposerState']
  activeThreadData: AppShellController['activeThreadData']
  composerProjectId: string
  diffBaseline: ProjectDiffBaseline
  diffRenderMode: ProjectDiffRenderMode
  terminalSessionPath: string | null
  onSetDiffBaseline: (baseline: ProjectDiffBaseline) => void
  onSetDiffRenderMode: (mode: ProjectDiffRenderMode) => void
  sidebarCollapsed: boolean
  sidebarAutoHidden: boolean
  sidebarCompactMode: boolean
  onToggleSidebar: () => void
  onArtifactDrawerOverlayChange?: (visible: boolean, onClose?: (() => void) | undefined) => void
}

export function MobileWorkspaceView(props: MobileWorkspaceViewProps) {
  const {
    controller,
    activeComposerState,
    activeThreadData,
    composerProjectId,
    diffBaseline,
    diffRenderMode,
    terminalSessionPath,
    onSetDiffBaseline,
    onSetDiffRenderMode,
    sidebarCollapsed,
    sidebarAutoHidden,
    sidebarCompactMode,
    onToggleSidebar,
    onArtifactDrawerOverlayChange,
  } = props

  // Force hoverToFocus to false on mobile
  const mobileAppSettings: AppSettings = {
    chatModel: null,
    chatThinkingLevel: null,
    codeModel: null,
    codeThinkingLevel: null,
    gitCommitMessageModel: null,
    gitCommitMessageThinkingLevel: 'off',
    skillCreatorModel: null,
    skillCreatorThinkingLevel: 'off',
    composerStreamingBehavior: 'followUp',
    dictationModelId: null,
    dictationMaxDurationSeconds: 180,
    showDictationButton: true,
    favoriteFolders: [],
    projectImportState: null,
    preferredProjectLocation: null,
    initializeGitOnProjectCreate: false,
    gitOpsDefaultMode: 'commit',
    gitDiffBaselineDefault: { kind: 'head' },
    gitDiffRenderModeDefault: 'stacked',
    gitDiffFileTreeDefaultVisible: true,
    projectDeletionMode: 'pi-only',
    useAgentsSkillsPaths: false,
    howcodeNativeAskQuestions: false,
    piTuiTakeover: false,
    hoverToFocus: false, // KEY: Disable hover-to-focus on mobile
    hoverToBlur: false,
  }

  return (
    <ChatWorkspaceView
      controller={controller}
      activeComposerState={activeComposerState}
      activeThreadData={activeThreadData}
      composerProjectId={composerProjectId}
      diffBaseline={diffBaseline}
      diffRenderMode={diffRenderMode}
      terminalSessionPath={terminalSessionPath}
      onSetDiffBaseline={onSetDiffBaseline}
      onSetDiffRenderMode={onSetDiffRenderMode}
      sidebarCollapsed={sidebarCollapsed}
      sidebarAutoHidden={sidebarAutoHidden}
      sidebarCompactMode={sidebarCompactMode}
      onToggleSidebar={onToggleSidebar}
      onArtifactDrawerOverlayChange={onArtifactDrawerOverlayChange}
    />
  )
}
