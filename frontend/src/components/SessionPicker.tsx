import { useEffect, useCallback, useRef } from 'react'
import { Command } from 'cmdk'
import { useNavigate } from 'react-router-dom'
import { useAppSelector, useAppDispatch } from '../store'
import { switchSlot } from '../store/chatSlice'

interface SessionPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function SessionPicker({ open, onOpenChange }: SessionPickerProps) {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const rawSlots = useAppSelector(s => s.dashboard.slots)
  const slots = [...rawSlots].sort((a, b) => {
    if (a.running !== b.running) return a.running ? -1 : 1
    const ta = a.updated ? new Date(a.updated).getTime() : 0
    const tb = b.updated ? new Date(b.updated).getTime() : 0
    return tb - ta
  })
  const activeSlot = useAppSelector(s => s.chat.activeSlot)
  const inputRef = useRef<HTMLInputElement>(null)

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
      {open && <div className="cmdk-overlay" onClick={close} />}

      <Command.Dialog
        open={open}
        onOpenChange={onOpenChange}
        label="Switch session"
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
            placeholder="Switch session…"
            className="cmdk-input"
          />
          <kbd className="cmdk-badge">ESC</kbd>
        </div>

        <Command.List className="cmdk-list">
          <Command.Empty className="cmdk-empty">No sessions found.</Command.Empty>

          {/* Sessions first — most recent is default selection */}
          {slots.length > 0 && (
            <Command.Group heading="Sessions" className="cmdk-group">
              {slots.map(slot => (
                <Command.Item
                  key={slot.key}
                  value={`session ${slot.title} ${slot.key} ${(slot.tags || []).join(' ')}`}
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
                    {slot.tags && slot.tags.length > 0 && <span className="cmdk-item-meta">{slot.tags.map(t => `#${t}`).join(' ')}</span>}
                  </div>
                  {activeSlot === slot.key && <span className="cmdk-item-badge">Active</span>}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {/* New session at bottom */}
          <Command.Item
            value="new session create"
            onSelect={() => run(() => { dispatch(switchSlot(null)); navigate('/chat') })}
            className="cmdk-item"
          >
            <span className="cmdk-item-icon">✨</span>
            <span className="cmdk-item-label">New Session</span>
            <kbd className="cmdk-kbd">Ctrl+N</kbd>
          </Command.Item>
        </Command.List>
      </Command.Dialog>
    </>
  )
}
