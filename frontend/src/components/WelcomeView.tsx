import { useEffect, useRef, useState } from 'react'
import SlashCommandMenu from './SlashCommandMenu'
import DirTree from './DirTree'
import { modelLabel } from '../utils/modelUtils'

interface Model {
  id: string
  name?: string | null
  provider: string
  contextWindow?: number
}

interface Workspace {
  name: string
  path: string
}

interface PendingImage {
  data: string
  mimeType: string
  preview: string
}

interface WelcomeViewProps {
  input: string
  setInput: (v: string) => void
  send: () => void
  models: Model[]
  selectedModel: string
  onSelectModel: (model: string) => void
  workspaces: Workspace[]
  selectedCwd: string
  onSelectCwd: (cwd: string) => void
  prefillHint?: boolean
  onDismissHint?: () => void
  pendingImages: PendingImage[]
  onPaste: (e: React.ClipboardEvent) => void
  onRemoveImage: (idx: number) => void
  inputRef?: React.RefObject<HTMLTextAreaElement>
}

const SUGGESTED_PROMPTS = [
  { label: 'Explain a codebase', prompt: 'Give me an overview of this codebase — key files, architecture, and where to start reading.' },
  { label: 'Debug an error', prompt: 'I\'m seeing this error: ' },
  { label: 'Write tests', prompt: 'Write tests for the following code: ' },
  { label: 'Review a PR', prompt: 'Review the recent git changes and give me feedback on code quality, potential bugs, and improvements.' },
  { label: 'Refactor code', prompt: 'Refactor this file for readability and maintainability: ' },
  { label: 'Morning brief', prompt: '/skill:morning-brief' },
]

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function WelcomeView({
  input, setInput, send,
  models, selectedModel, onSelectModel,
  workspaces, selectedCwd, onSelectCwd,
  prefillHint, onDismissHint,
  pendingImages, onPaste, onRemoveImage,
  inputRef: externalRef,
}: WelcomeViewProps) {
  const internalRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = externalRef || internalRef
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [showConfig, setShowConfig] = useState(false)

  useEffect(() => {
    if (inputRef.current && input) {
      const cap = prefillHint ? 320 : 140
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, cap) + 'px'
    }
  }, [input, prefillHint])

  const selectedModelInfo = models.find(m => `${m.provider}/${m.id}` === selectedModel)
  const modelName = selectedModelInfo ? modelLabel(selectedModelInfo) : 'Default'
  const cwdName = selectedCwd ? selectedCwd.split('/').pop() || selectedCwd : null

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 md:px-8 gap-0">
      {/* Logo + greeting */}
      <div className="flex flex-col items-center gap-3 mb-8">
        <span className="text-5xl select-none">🥧</span>
        <h1 className="text-xl font-semibold text-text-strong">{getGreeting()}</h1>
        <p className="text-[14px] text-muted text-center max-w-[280px]">What can I help you with?</p>
      </div>

      {/* Suggested prompts */}
      <div className="grid grid-cols-2 gap-2 w-full max-w-[560px] mb-6">
        {SUGGESTED_PROMPTS.map(s => (
          <button
            key={s.label}
            className="text-left px-3.5 py-3 rounded-xl border border-border bg-card hover:border-accent/50 hover:bg-accent-subtle transition-all cursor-pointer text-[13px] text-text font-body group"
            onClick={() => { setInput(s.prompt); setTimeout(() => inputRef.current?.focus(), 50) }}
          >
            <span className="text-muted group-hover:text-accent transition-colors text-[12px] font-medium block mb-0.5">{s.label}</span>
            <span className="text-muted/60 text-[12px] line-clamp-1">{s.prompt.length > 40 ? s.prompt.slice(0, 40) + '…' : s.prompt}</span>
          </button>
        ))}
      </div>

      {/* Input area */}
      <div className="w-full max-w-[600px]">
        {prefillHint && (
          <div className="flex items-center gap-2 px-4 py-2 mb-2 bg-accent/10 border border-accent/30 rounded-lg">
            <span className="text-accent text-[13px]">📋 Plan pre-filled below</span>
            <button className="text-muted text-[12px] hover:text-text ml-auto" onClick={onDismissHint}>✕</button>
          </div>
        )}
        <div className="relative bg-card border border-border rounded-2xl shadow-[0_2px_20px_rgba(0,0,0,0.15)] overflow-visible">
          <SlashCommandMenu input={input} anchorRef={inputRef as React.RefObject<HTMLElement>} open={slashMenuOpen} onSelect={cmd => { setInput(cmd); setSlashMenuOpen(true) }} onClose={() => setSlashMenuOpen(false)} />
          {pendingImages.length > 0 && (
            <div className="flex gap-2 flex-wrap px-4 pt-3">
              {pendingImages.map((img, i) => (
                <div key={i} className="relative group">
                  <img src={img.preview} alt="Pasted" className="h-16 rounded-md border border-border object-cover" />
                  <button className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-danger text-white text-[11px] border-none cursor-pointer opacity-40 group-hover:opacity-100 transition-opacity flex items-center justify-center" onClick={() => onRemoveImage(i)}>✕</button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            aria-label="Message input"
            className="w-full bg-transparent px-4 pt-4 pb-3 text-text text-[15px] font-body outline-none resize-none max-h-[200px] leading-relaxed placeholder:text-muted/50 block"
            placeholder="Message Pi…"
            rows={2}
            value={input}
            onChange={e => { const val = e.target.value; setInput(val); if (val.startsWith('/')) setSlashMenuOpen(true); else setSlashMenuOpen(false) }}
            onPaste={onPaste}
            onCompositionStart={() => { (inputRef.current as any).__composing = true }}
            onCompositionEnd={() => { (inputRef.current as any).__composing = true; setTimeout(() => { if (inputRef.current) (inputRef.current as any).__composing = false }, 50) }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.defaultPrevented && !e.nativeEvent.isComposing && !(inputRef.current as any)?.__composing) { e.preventDefault(); send() } }}
            onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 200) + 'px' }}
          />
          <div className="flex items-center justify-between px-3 pb-3 gap-2">
            {/* Model + CWD config toggle */}
            <button
              className="flex items-center gap-1.5 text-[12px] text-muted hover:text-text transition-colors px-2 py-1 rounded-lg hover:bg-bg-hover border-none bg-transparent cursor-pointer"
              onClick={() => setShowConfig(v => !v)}
              title="Model & workspace"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 stroke-current fill-none" strokeWidth={2} strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              <span className="font-mono">{modelName}{cwdName ? ` · ${cwdName}` : ''}</span>
            </button>
            <button
              className="btn-sweep bg-accent text-white border-none rounded-xl w-9 h-9 text-base font-semibold cursor-pointer hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center"
              onClick={() => send()}
              disabled={!input.trim() && pendingImages.length === 0}
            >↑</button>
          </div>
          {showConfig && (
            <div className="border-t border-border px-4 py-3 flex flex-col md:flex-row gap-3">
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-[11px] text-muted font-medium uppercase tracking-wider">Model</label>
                <select
                  className="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text font-mono cursor-pointer focus-ring w-full"
                  value={selectedModel}
                  onChange={e => onSelectModel(e.target.value)}
                >
                  <option value="">Default ({selectedModelInfo?.name || 'auto'})</option>
                  {models.map(m => (
                    <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>{modelLabel(m)}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-[11px] text-muted font-medium uppercase tracking-wider">Directory</label>
                <DirTree value={selectedCwd} onChange={onSelectCwd} workspaces={workspaces} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
