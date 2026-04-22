import { useEffect, useRef, useState } from 'react'
import SlashCommandMenu from './SlashCommandMenu'
import DirTree from './DirTree'

interface Model {
  id: string
  name: string
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
  const [slashMenuOpen, setSlashMenuOpen] = useState(true)
  const [modelSearch] = useState('')

  useEffect(() => {
    if (inputRef.current && input) {
      const cap = prefillHint ? 320 : 140
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, cap) + 'px'
    }
  }, [input, prefillHint])

  const filteredModels = models.filter(m => {
    if (!modelSearch) return true
    const q = modelSearch.toLowerCase()
    return m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q)
  })

  // Group models by provider
  const grouped = new Map<string, Model[]>()
  for (const m of filteredModels) {
    const key = m.provider
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(m)
  }

  const selectedModelInfo = models.find(m => `${m.provider}/${m.id}` === selectedModel)

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 px-4 md:px-8">
      <span className="text-4xl">🥧</span>
      <div className="text-center">
        <h2 className="text-lg font-semibold text-text mb-1">New Session</h2>
        <p className="text-[13px] text-muted">Pick a model and workspace, then start chatting.</p>
      </div>

      {/* Pickers row */}
      <div className="flex flex-col md:flex-row gap-4 flex-wrap justify-center w-full max-w-[700px]">
        {/* Model picker */}
        <div className="flex flex-col gap-1.5 flex-1 min-w-0 md:min-w-[280px]">
          <label className="text-[12px] text-muted font-medium uppercase tracking-wider">Model</label>
          <select
            className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text font-mono cursor-pointer focus-ring w-full"
            value={selectedModel}
            onChange={e => onSelectModel(e.target.value)}
          >
            {models.length === 0
              ? <option value="" disabled>Loading models…</option>
              : <option value="">Default ({selectedModelInfo?.name || 'auto'})</option>
            }
            {Array.from(grouped.entries()).map(([provider, provModels]) => (
              <optgroup key={provider} label={provider}>
                {provModels.map(m => (
                  <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                    {m.name} {m.contextWindow ? `(${Math.round(m.contextWindow / 1000)}K)` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Workspace/CWD picker */}
        <div className="flex flex-col gap-1.5 flex-1 min-w-0 md:min-w-[200px]">
          <label className="text-[12px] text-muted font-medium uppercase tracking-wider">Working Directory</label>
          <DirTree value={selectedCwd} onChange={onSelectCwd} workspaces={workspaces} />
        </div>
      </div>

      {/* Input */}
      <div className="w-full max-w-[700px]">
        {prefillHint && (
          <div className="flex items-center gap-2 px-4 py-2 mb-2 bg-accent/10 border border-accent/30 rounded-lg">
            <span className="text-accent text-[13px]">📋 Plan pre-filled below</span>
            <button className="text-muted text-[12px] hover:text-text ml-auto" onClick={onDismissHint}>✕</button>
          </div>
        )}
        <div className="flex flex-col md:flex-row gap-2.5 md:items-end">
          <SlashCommandMenu input={input} anchorRef={inputRef as React.RefObject<HTMLElement>} open={slashMenuOpen} onSelect={cmd => { setInput(cmd); setSlashMenuOpen(true) }} onClose={() => setSlashMenuOpen(false)} />
          <div className="w-full flex-1 flex flex-col gap-1.5">
            {pendingImages.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {pendingImages.map((img, i) => (
                  <div key={i} className="relative group">
                    <img src={img.preview} alt="Pasted" className="h-16 rounded-md border border-border object-cover" />
                    <button className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-danger text-white text-[11px] border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center" onClick={() => onRemoveImage(i)}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <textarea ref={inputRef} aria-label="Message input" className={`bg-bg-elevated border border-border rounded-lg px-4 py-3 text-text text-sm font-body outline-none min-h-[44px] leading-normal transition-all focus-ring placeholder:text-muted ${prefillHint ? 'resize-y max-h-[50vh]' : 'resize-none max-h-[140px]'}`} placeholder={pendingImages.length > 0 ? 'Add a message about the image(s)…' : 'Message Pi…'} rows={1} value={input}
              onChange={e => { const val = e.target.value; setInput(val); if (val.startsWith('/')) setSlashMenuOpen(true) }}
              onPaste={onPaste}
              onCompositionStart={() => { (inputRef.current as any).__composing = true }}
              onCompositionEnd={() => { (inputRef.current as any).__composing = true; setTimeout(() => { if (inputRef.current) (inputRef.current as any).__composing = false }, 50) }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.defaultPrevented && !e.nativeEvent.isComposing && !(inputRef.current as any)?.__composing) { e.preventDefault(); send() } }}
              onInput={e => { const t = e.target as HTMLTextAreaElement; const cap = prefillHint ? 320 : 140; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, cap) + 'px' }} />
          </div>
          <button className="btn-sweep bg-accent text-white border-none rounded-lg w-full md:w-auto px-5 h-[44px] text-sm font-semibold cursor-pointer hover:bg-accent-hover hover:shadow-[0_0_20px_var(--accent-glow)] disabled:opacity-30 disabled:cursor-not-allowed transition-all font-body" onClick={() => send()} disabled={!input.trim() && pendingImages.length === 0}>Send</button>
        </div>
      </div>
    </div>
  )
}
