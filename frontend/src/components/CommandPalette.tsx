import { useEffect, useCallback, useRef } from 'react'
import { Command } from 'cmdk'
import { useNavigate } from 'react-router-dom'
import { useAppSelector, useAppDispatch } from '../store'
import { switchSlot } from '../store/chatSlice'
import { fetchSlots } from '../store/dashboardSlice'
import { useTheme } from '../hooks/useTheme'
import { loadPinnedDirs } from '../pages/chat/PinnedDirs'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onToggleSidebar: () => void
  onNewSessionInCwd?: (cwd: string) => void
}

export default function CommandPalette({ open, onOpenChange, onToggleSidebar, onNewSessionInCwd }: CommandPaletteProps) {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const slots = useAppSelector(s => s.dashboard.slots)
  const activeSlot = useAppSelector(s => s.chat.activeSlot)
  const { cycle: cycleTheme } = useTheme()
  const inputRef = useRef<HTMLInputElement>(null)
  const pinnedDirs = open ? loadPinnedDirs() : []

  // Focus input when opening
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  const close = useCallback(() => onOpenChange(false), [onOpenChange])

  const run = useCallback((fn: () => void) => {
    close()
    fn()
  }, [close])

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="cmdk-overlay"
          onClick={close}
        />
      )}

      {/* Dialog */}
      <Command.Dialog
        open={open}
        onOpenChange={onOpenChange}
        label="Command palette"
        className="cmdk-dialog"
        shouldFilter={true}
      >
        <div className="cmdk-input-wrapper">
          <svg className="cmdk-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <Command.Input
            ref={inputRef}
            placeholder="Type a command or search…"
            className="cmdk-input"
          />
          <kbd className="cmdk-badge">ESC</kbd>
        </div>

        <Command.List className="cmdk-list">
          <Command.Empty className="cmdk-empty">No results found.</Command.Empty>

          {/* Sessions */}
          {slots.length > 0 && (
            <Command.Group heading="Sessions" className="cmdk-group">
              {slots.map(slot => (
                <Command.Item
                  key={slot.key}
                  value={`session ${slot.title} ${slot.key}`}
                  onSelect={() => run(() => { dispatch(switchSlot(slot.key)); navigate('/chat') })}
                  className="cmdk-item"
                >
                  <span className="cmdk-item-icon">
                    {slot.running ? (
                      <span className="cmdk-dot cmdk-dot-active" />
                    ) : (
                      <span className="cmdk-dot" />
                    )}
                  </span>
                  <div className="cmdk-item-content">
                    <span className="cmdk-item-label">{slot.title || slot.key}</span>
                    {slot.model && <span className="cmdk-item-meta">{slot.model}</span>}
                  </div>
                  {activeSlot === slot.key && <span className="cmdk-item-badge">Active</span>}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {/* Navigate */}

          {/* Pinned Directories */}
          {pinnedDirs.length > 0 && (
            <Command.Group heading="Pinned Directories" className="cmdk-group">
              {pinnedDirs.map(dir => (
                <Command.Item
                  key={dir}
                  value={`pinned directory ${dir} ${dir.split('/').pop()}`}
                  onSelect={() => run(() => { if (onNewSessionInCwd) { onNewSessionInCwd(dir); navigate('/chat') } })}
                  className="cmdk-item"
                >
                  <span className="cmdk-item-icon">📌</span>
                  <div className="cmdk-item-content">
                    <span className="cmdk-item-label">{dir.split('/').pop()}</span>
                    <span className="cmdk-item-meta">{dir}</span>
                  </div>
                  <span className="cmdk-item-badge">▶ new</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {/* Navigate */}
          <Command.Group heading="Navigate" className="cmdk-group">
            <Command.Item value="Go to Chat" onSelect={() => run(() => navigate('/chat'))} className="cmdk-item">
              <span className="cmdk-item-icon">💬</span>
              <span className="cmdk-item-label">Go to Chat</span>
              <kbd className="cmdk-kbd">Ctrl+1</kbd>
            </Command.Item>
            <Command.Item value="Go to System" onSelect={() => run(() => navigate('/system'))} className="cmdk-item">
              <span className="cmdk-item-icon">🖥</span>
              <span className="cmdk-item-label">Go to System</span>
              <kbd className="cmdk-kbd">Ctrl+2</kbd>
            </Command.Item>
            <Command.Item value="Go to Logs" onSelect={() => run(() => navigate('/logs'))} className="cmdk-item">
              <span className="cmdk-item-icon">📄</span>
              <span className="cmdk-item-label">Go to Logs</span>
              <kbd className="cmdk-kbd">Ctrl+3</kbd>
            </Command.Item>
            <Command.Item value="Go to Settings" onSelect={() => run(() => navigate('/settings'))} className="cmdk-item">
              <span className="cmdk-item-icon">⚙</span>
              <span className="cmdk-item-label">Go to Settings</span>
              <kbd className="cmdk-kbd">Ctrl+4</kbd>
            </Command.Item>
          </Command.Group>

          {/* Actions */}
          <Command.Group heading="Actions" className="cmdk-group">
            <Command.Item value="New session /new" onSelect={() => run(() => { dispatch(switchSlot(null)); navigate('/chat') })} className="cmdk-item">
              <span className="cmdk-item-icon">✨</span>
              <span className="cmdk-item-label">New Session</span>
              <kbd className="cmdk-kbd">Ctrl+N</kbd>
            </Command.Item>
            <Command.Item value="Toggle theme dark light" onSelect={() => run(cycleTheme)} className="cmdk-item">
              <span className="cmdk-item-icon">🎨</span>
              <span className="cmdk-item-label">Toggle Theme</span>
            </Command.Item>
            <Command.Item value="Toggle sidebar" onSelect={() => run(onToggleSidebar)} className="cmdk-item">
              <span className="cmdk-item-icon">📐</span>
              <span className="cmdk-item-label">Toggle Sidebar</span>
              <kbd className="cmdk-kbd">Ctrl+\</kbd>
            </Command.Item>
            <Command.Item value="Refresh reload" onSelect={() => run(() => { dispatch(fetchSlots()) })} className="cmdk-item">
              <span className="cmdk-item-icon">🔄</span>
              <span className="cmdk-item-label">Refresh</span>
            </Command.Item>
          </Command.Group>

          {/* Slash Commands */}
          <Command.Group heading="Slash Commands" className="cmdk-group">
            <Command.Item value="/new create session" onSelect={() => run(() => { dispatch(switchSlot(null)); navigate('/chat') })} className="cmdk-item">
              <span className="cmdk-item-icon cmdk-slash">/new</span>
              <span className="cmdk-item-label">Create new session</span>
            </Command.Item>
            <Command.Item value="/clear reset session" onSelect={() => run(() => { dispatch(switchSlot(null)); navigate('/chat') })} className="cmdk-item">
              <span className="cmdk-item-icon cmdk-slash">/clear</span>
              <span className="cmdk-item-label">Clear current session</span>
            </Command.Item>
            <Command.Item value="/compact compress context" onSelect={() => run(() => navigate('/chat'))} className="cmdk-item">
              <span className="cmdk-item-icon cmdk-slash">/compact</span>
              <span className="cmdk-item-label">Compact current context</span>
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command.Dialog>
    </>
  )
}
