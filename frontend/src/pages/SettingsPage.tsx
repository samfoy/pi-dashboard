import { useState, useEffect, useCallback } from 'react'
import { PageHeader, Card, CardTitle, SearchInput, Badge } from '../components/ui'
import InfoTip from '../components/InfoTip'
import { api, j } from '../api/client'
import { useAppSelector } from '../store'
import { useTheme } from '../hooks/useTheme'
import { loadChatConfig, saveChatConfig, type ChatConfig } from './chat/ChatSettings'

type Tab = 'general' | 'model' | 'behavior' | 'terminal' | 'skills' | 'chat' | 'display' | 'vault' | 'developer'

/* ── Shared form components ── */

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer group py-2">
      <div>
        <span className="text-[13px] text-text group-hover:text-text-strong transition-colors">{label}</span>
        {hint && <div className="text-[12px] text-muted/60 mt-0.5">{hint}</div>}
      </div>
      <div className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ml-4 ${checked ? 'bg-accent' : 'bg-border'}`} onClick={() => onChange(!checked)}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </div>
    </label>
  )
}

function SelectRow({ label, hint, value, options, onChange }: { label: string; hint?: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <span className="text-[13px] text-text">{label}</span>
        {hint && <div className="text-[12px] text-muted/60 mt-0.5">{hint}</div>}
      </div>
      <select
        className="bg-bg-elevated border border-border rounded-md px-3 py-1.5 text-[13px] text-text font-body outline-none cursor-pointer transition-colors focus-ring ml-4"
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function NumberRow({ label, hint, value, onChange, min, max, step, placeholder }: { label: string; hint?: string; value: number | undefined; onChange: (v: number | undefined) => void; min?: number; max?: number; step?: number; placeholder?: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <span className="text-[13px] text-text">{label}</span>
        {hint && <div className="text-[12px] text-muted/60 mt-0.5">{hint}</div>}
      </div>
      <input
        type="number"
        className="w-28 bg-bg-elevated border border-border rounded-md px-2.5 py-1.5 text-[13px] font-mono text-text outline-none focus-ring transition-colors text-right ml-4"
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
      />
    </div>
  )
}

function TextRow({ label, hint, value, onChange, placeholder, mono }: { label: string; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="min-w-0 mr-4">
        <span className="text-[13px] text-text">{label}</span>
        {hint && <div className="text-[12px] text-muted/60 mt-0.5">{hint}</div>}
      </div>
      <input
        className={`w-64 bg-bg-elevated border border-border rounded-md px-2.5 py-1.5 text-[13px] text-text outline-none focus-ring transition-colors text-right ml-4 ${mono ? 'font-mono' : 'font-body'}`}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-wider text-muted pt-3 pb-1">{children}</div>
}

/* ── Pi settings type ── */

interface PiSettings {
  defaultProvider?: string
  defaultModel?: string
  enabledModels?: string[]
  packages?: (string | object)[]
  defaultThinkingLevel?: string
  hideThinkingBlock?: boolean
  enableSkillCommands?: boolean
  steeringMode?: string
  followUpMode?: string
  theme?: string
  shellPath?: string
  quietStartup?: boolean
  shellCommandPrefix?: string
  collapseChangelog?: boolean
  doubleEscapeAction?: string
  treeFilterMode?: string
  showHardwareCursor?: boolean
  editorPaddingX?: number
  autocompleteMaxVisible?: number
  compaction?: {
    enabled?: boolean
    reserveTokens?: number
    keepRecentTokens?: number
  }
  branchSummary?: {
    reserveTokens?: number
    skipPrompt?: boolean
  }
  retry?: {
    enabled?: boolean
    maxRetries?: number
    baseDelayMs?: number
    maxDelayMs?: number
  }
  terminal?: {
    showImages?: boolean
    clearOnShrink?: boolean
  }
  images?: {
    autoResize?: boolean
    blockImages?: boolean
  }
  thinkingBudgets?: {
    minimal?: number
    low?: number
    medium?: number
    high?: number
  }
  markdown?: {
    codeBlockIndent?: string
  }
  extensions?: string[]
  skills?: string[]
  prompts?: string[]
  themes?: string[]
  [key: string]: unknown
}

interface GalleryPkg {
  name: string
  description: string
  version: string
  author: string
  date: string
  links: { npm?: string; homepage?: string; repository?: string }
}

/* ── Feedback banner ── */
function Feedback({ feedback }: { feedback: { type: 'ok' | 'err'; msg: string } | null }) {
  if (!feedback) return null
  return (
    <div className={`px-3 py-2 rounded-md text-[13px] font-medium animate-scale-in ${feedback.type === 'ok' ? 'bg-ok-subtle text-ok border border-ok/20' : 'bg-danger-subtle text-danger border border-danger/20'}`}>
      {feedback.msg}
    </div>
  )
}

/* ── Shared settings hook ── */
function usePiSettings() {
  const [settings, setSettings] = useState<PiSettings | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  useEffect(() => {
    fetch('/api/pi/settings').then(j).then(setSettings).catch(() => {})
  }, [])

  const save = useCallback(async (next: PiSettings) => {
    setSettings(next)
    try {
      await fetch('/api/pi/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
      setFeedback({ type: 'ok', msg: 'Saved' })
    } catch { setFeedback({ type: 'err', msg: 'Save failed' }) }
    setTimeout(() => setFeedback(null), 2000)
  }, [])

  const set = useCallback((key: string, value: unknown) => {
    if (!settings) return
    save({ ...settings, [key]: value })
  }, [settings, save])

  const setNested = useCallback((parent: string, key: string, value: unknown) => {
    if (!settings) return
    const existing = (settings as any)[parent] || {}
    save({ ...settings, [parent]: { ...existing, [key]: value } })
  }, [settings, save])

  return { settings, feedback, set, setNested, save, setSettings }
}

/* ── MODEL TAB ── */
function ModelTab() {
  const { settings, feedback, set, setNested } = usePiSettings()
  if (!settings) return <div className="text-muted text-[13px] py-4">Loading settings…</div>

  return (
    <div className="space-y-4">
      <Feedback feedback={feedback} />

      <Card>
        <CardTitle>Default Model <InfoTip text="Provider and model used for new sessions" /></CardTitle>
        <div className="divide-y divide-border">
          <div className="flex items-center justify-between py-2">
            <div>
              <span className="text-[13px] text-text">Default Provider</span>
              <div className="text-[12px] text-muted/60 mt-0.5">LLM provider for new sessions</div>
            </div>
            <span className="text-[13px] font-mono text-accent">{settings.defaultProvider || '—'}</span>
          </div>
          <SelectRow
            label="Default Model"
            hint="Model used for new sessions"
            value={settings.defaultModel || ''}
            options={[
              { value: '', label: '— default —' },
              ...(settings.enabledModels || []).map(m => ({ value: m.split('/').pop() || m, label: m }))
            ]}
            onChange={v => set('defaultModel', v || undefined)}
          />
        </div>
      </Card>

      <Card>
        <CardTitle>Thinking <InfoTip text="Controls how deeply the model reasons before responding" /></CardTitle>
        <div className="divide-y divide-border">
          <SelectRow
            label="Default thinking level"
            hint="Depth of reasoning for new sessions"
            value={settings.defaultThinkingLevel || 'medium'}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'minimal', label: 'Minimal' },
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
              { value: 'xhigh', label: 'Extra High' },
            ]}
            onChange={v => set('defaultThinkingLevel', v)}
          />
          <Toggle label="Hide thinking blocks" hint="Collapse thinking output in the TUI" checked={settings.hideThinkingBlock ?? false} onChange={v => set('hideThinkingBlock', v)} />
        </div>
      </Card>

      <Card>
        <CardTitle>Thinking Budgets <InfoTip text="Token budgets allocated per thinking level. Higher = more thorough reasoning but slower." /></CardTitle>
        <div className="divide-y divide-border">
          <NumberRow label="Minimal" hint="Tokens for 'minimal' thinking" value={settings.thinkingBudgets?.minimal} onChange={v => setNested('thinkingBudgets', 'minimal', v)} placeholder="1024" />
          <NumberRow label="Low" hint="Tokens for 'low' thinking" value={settings.thinkingBudgets?.low} onChange={v => setNested('thinkingBudgets', 'low', v)} placeholder="2048" />
          <NumberRow label="Medium" hint="Tokens for 'medium' thinking" value={settings.thinkingBudgets?.medium} onChange={v => setNested('thinkingBudgets', 'medium', v)} placeholder="4096" />
          <NumberRow label="High" hint="Tokens for 'high' thinking" value={settings.thinkingBudgets?.high} onChange={v => setNested('thinkingBudgets', 'high', v)} placeholder="8192" />
        </div>
      </Card>

      <Card>
        <CardTitle>Enabled Models <InfoTip text="Glob patterns to filter which models appear in the model picker. Empty = all models." /></CardTitle>
        <div className="text-[12px] text-muted/60 mb-2">One pattern per line. Supports wildcards (e.g. <code className="font-mono text-text">claude-*</code>, <code className="font-mono text-text">*/gpt-4o</code>)</div>
        <textarea
          className="w-full bg-bg-elevated border border-border rounded-md p-3 text-[13px] font-mono text-text resize-none outline-none focus-ring leading-relaxed min-h-[80px]"
          value={(settings.enabledModels || []).join('\n')}
          onChange={e => {
            const lines = e.target.value.split('\n')
            set('enabledModels', lines.filter(l => l.trim()))
          }}
          placeholder="claude-*&#10;*/gpt-4o&#10;anthropic/*"
          spellCheck={false}
        />
      </Card>
    </div>
  )
}

/* ── BEHAVIOR TAB ── */
function BehaviorTab() {
  const { settings, feedback, set, setNested } = usePiSettings()
  if (!settings) return <div className="text-muted text-[13px] py-4">Loading settings…</div>

  return (
    <div className="space-y-4">
      <Feedback feedback={feedback} />

      <Card>
        <CardTitle>Interaction Mode <InfoTip text="How pi handles tool calls and follow-up messages" /></CardTitle>
        <div className="divide-y divide-border">
          <SelectRow
            label="Steering mode"
            hint="How multiple tool calls are handled"
            value={settings.steeringMode || 'all'}
            options={[
              { value: 'all', label: 'All at once' },
              { value: 'one-at-a-time', label: 'One at a time' },
            ]}
            onChange={v => set('steeringMode', v)}
          />
          <SelectRow
            label="Follow-up mode"
            hint="How follow-up messages are processed"
            value={settings.followUpMode || 'all'}
            options={[
              { value: 'all', label: 'All at once' },
              { value: 'one-at-a-time', label: 'One at a time' },
            ]}
            onChange={v => set('followUpMode', v)}
          />
          <Toggle label="Skill commands" hint="Enable /skill slash commands in the TUI" checked={settings.enableSkillCommands ?? true} onChange={v => set('enableSkillCommands', v)} />
          <Toggle label="Quiet startup" hint="Suppress startup banners and messages" checked={settings.quietStartup ?? false} onChange={v => set('quietStartup', v)} />
          <Toggle label="Collapse changelog" hint="Auto-collapse changelog on startup" checked={settings.collapseChangelog ?? false} onChange={v => set('collapseChangelog', v)} />
        </div>
      </Card>

      <Card>
        <CardTitle>Compaction <InfoTip text="Automatic context compaction when conversation gets long" /></CardTitle>
        <div className="divide-y divide-border">
          <Toggle label="Enable compaction" hint="Automatically compact context when it exceeds limits" checked={settings.compaction?.enabled ?? true} onChange={v => setNested('compaction', 'enabled', v)} />
          <NumberRow label="Reserve tokens" hint="Tokens reserved for compaction summary" value={settings.compaction?.reserveTokens} onChange={v => setNested('compaction', 'reserveTokens', v)} placeholder="8192" />
          <NumberRow label="Keep recent tokens" hint="Recent tokens preserved during compaction" value={settings.compaction?.keepRecentTokens} onChange={v => setNested('compaction', 'keepRecentTokens', v)} placeholder="4096" />
        </div>
      </Card>

      <Card>
        <CardTitle>Branch Summary <InfoTip text="Settings for conversation branch summaries" /></CardTitle>
        <div className="divide-y divide-border">
          <Toggle label="Skip summary prompt" hint="Skip the branch summary confirmation prompt" checked={settings.branchSummary?.skipPrompt ?? false} onChange={v => setNested('branchSummary', 'skipPrompt', v)} />
          <NumberRow label="Reserve tokens" hint="Tokens reserved for branch summaries" value={settings.branchSummary?.reserveTokens} onChange={v => setNested('branchSummary', 'reserveTokens', v)} placeholder="4096" />
        </div>
      </Card>

      <Card>
        <CardTitle>Retry <InfoTip text="Automatic retry behavior when API calls fail" /></CardTitle>
        <div className="divide-y divide-border">
          <Toggle label="Enable retries" hint="Automatically retry failed API requests" checked={settings.retry?.enabled ?? true} onChange={v => setNested('retry', 'enabled', v)} />
          <NumberRow label="Max retries" hint="Maximum number of retry attempts" value={settings.retry?.maxRetries} onChange={v => setNested('retry', 'maxRetries', v)} min={0} max={10} placeholder="3" />
          <NumberRow label="Base delay (ms)" hint="Initial delay before first retry" value={settings.retry?.baseDelayMs} onChange={v => setNested('retry', 'baseDelayMs', v)} min={100} placeholder="1000" />
          <NumberRow label="Max delay (ms)" hint="Maximum delay between retries" value={settings.retry?.maxDelayMs} onChange={v => setNested('retry', 'maxDelayMs', v)} min={100} placeholder="30000" />
        </div>
      </Card>
    </div>
  )
}

/* ── TERMINAL TAB ── */
function TerminalTab() {
  const { settings, feedback, set, setNested } = usePiSettings()
  if (!settings) return <div className="text-muted text-[13px] py-4">Loading settings…</div>

  return (
    <div className="space-y-4">
      <Feedback feedback={feedback} />

      <Card>
        <CardTitle>Shell <InfoTip text="Shell and command settings for the TUI terminal" /></CardTitle>
        <div className="divide-y divide-border">
          <TextRow label="Shell path" hint="Path to the shell binary (e.g. /bin/zsh)" value={settings.shellPath || ''} onChange={v => set('shellPath', v || undefined)} placeholder="/bin/bash" mono />
          <TextRow label="Shell command prefix" hint="Prefix prepended to all shell commands" value={settings.shellCommandPrefix || ''} onChange={v => set('shellCommandPrefix', v || undefined)} placeholder="e.g. source ~/.profile &&" mono />
        </div>
      </Card>

      <Card>
        <CardTitle>TUI Display <InfoTip text="Terminal UI rendering options" /></CardTitle>
        <div className="divide-y divide-border">
          <Toggle label="Show images" hint="Render images inline in the TUI (iTerm2/Kitty)" checked={settings.terminal?.showImages ?? true} onChange={v => setNested('terminal', 'showImages', v)} />
          <Toggle label="Clear on shrink" hint="Clear screen when terminal shrinks" checked={settings.terminal?.clearOnShrink ?? false} onChange={v => setNested('terminal', 'clearOnShrink', v)} />
          <Toggle label="Show hardware cursor" hint="Use terminal's native cursor instead of TUI cursor" checked={settings.showHardwareCursor ?? false} onChange={v => set('showHardwareCursor', v)} />
          <NumberRow label="Editor padding X" hint="Horizontal padding in the editor (columns)" value={settings.editorPaddingX} onChange={v => set('editorPaddingX', v)} min={0} max={20} placeholder="2" />
          <NumberRow label="Autocomplete max visible" hint="Max suggestions shown in autocomplete dropdown" value={settings.autocompleteMaxVisible} onChange={v => set('autocompleteMaxVisible', v)} min={1} max={30} placeholder="8" />
        </div>
      </Card>

      <Card>
        <CardTitle>Images <InfoTip text="How images are handled in conversations" /></CardTitle>
        <div className="divide-y divide-border">
          <Toggle label="Auto-resize images" hint="Automatically resize large images before sending" checked={settings.images?.autoResize ?? true} onChange={v => setNested('images', 'autoResize', v)} />
          <Toggle label="Block images" hint="Prevent images from being sent to the model entirely" checked={settings.images?.blockImages ?? false} onChange={v => setNested('images', 'blockImages', v)} />
        </div>
      </Card>

      <Card>
        <CardTitle>Keyboard & Navigation <InfoTip text="TUI keyboard behavior" /></CardTitle>
        <div className="divide-y divide-border">
          <SelectRow
            label="Double-Escape action"
            hint="What happens when you press Escape twice"
            value={settings.doubleEscapeAction || 'fork'}
            options={[
              { value: 'fork', label: 'Fork conversation' },
              { value: 'tree', label: 'Show tree' },
              { value: 'none', label: 'None' },
            ]}
            onChange={v => set('doubleEscapeAction', v)}
          />
          <SelectRow
            label="Tree filter mode"
            hint="Default filter for the conversation tree view"
            value={settings.treeFilterMode || 'default'}
            options={[
              { value: 'default', label: 'Default' },
              { value: 'no-tools', label: 'No tools' },
              { value: 'user-only', label: 'User only' },
              { value: 'labeled-only', label: 'Labeled only' },
              { value: 'all', label: 'All messages' },
            ]}
            onChange={v => set('treeFilterMode', v)}
          />
        </div>
      </Card>

      <Card>
        <CardTitle>Markdown <InfoTip text="Markdown rendering options" /></CardTitle>
        <div className="divide-y divide-border">
          <TextRow label="Code block indent" hint="Indentation string for code blocks" value={settings.markdown?.codeBlockIndent || ''} onChange={v => setNested('markdown', 'codeBlockIndent', v || undefined)} placeholder="  " mono />
        </div>
      </Card>
    </div>
  )
}

/* ── GENERAL TAB (packages) ── */
function GeneralTab() {
  const [settings, setSettings] = useState<PiSettings | null>(null)
  const [gallery, setGallery] = useState<GalleryPkg[]>([])
  const [galleryFilter, setGalleryFilter] = useState('')
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [installInput, setInstallInput] = useState('')
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  useEffect(() => {
    fetch('/api/pi/settings').then(j).then(setSettings).catch(() => {})
  }, [])

  const loadGallery = useCallback(async () => {
    setGalleryLoading(true)
    try {
      const d = await fetch('/api/pi/gallery').then(j)
      setGallery(d.packages || [])
    } catch {}
    setGalleryLoading(false)
  }, [])

  useEffect(() => { loadGallery() }, [loadGallery])

  const installedPkgs = (settings?.packages || []).map(p => typeof p === 'string' ? p : (p as any).source || JSON.stringify(p))

  const installPkg = useCallback(async (source: string) => {
    setInstalling(source)
    setFeedback(null)
    try {
      await fetch('/api/pi/packages/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source }) }).then(j)
      setFeedback({ type: 'ok', msg: `Installed ${source}` })
      const s = await fetch('/api/pi/settings').then(j)
      setSettings(s)
    } catch (e: any) { setFeedback({ type: 'err', msg: e.message || 'Install failed' }) }
    setInstalling(null)
    setInstallInput('')
  }, [])

  const removePkg = useCallback(async (source: string) => {
    setInstalling(source)
    setFeedback(null)
    try {
      await fetch('/api/pi/packages/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source }) }).then(j)
      setFeedback({ type: 'ok', msg: `Removed ${source}` })
      const s = await fetch('/api/pi/settings').then(j)
      setSettings(s)
    } catch (e: any) { setFeedback({ type: 'err', msg: e.message || 'Remove failed' }) }
    setInstalling(null)
  }, [])

  const isInstalled = (name: string) => installedPkgs.some(p => p.includes(name))

  const filteredGallery = gallery.filter(p =>
    !galleryFilter || (p.name + p.description + p.author).toLowerCase().includes(galleryFilter.toLowerCase())
  )

  if (!settings) return <div className="text-muted text-[13px] py-4">Loading settings…</div>

  // Resource paths
  const resourceSections: { key: keyof PiSettings; label: string; hint: string; placeholder: string }[] = [
    { key: 'extensions', label: 'Extension Paths', hint: 'Paths to custom pi extensions', placeholder: './my-extension' },
    { key: 'skills', label: 'Skill Paths', hint: 'Paths to custom skill directories', placeholder: './my-skills/' },
    { key: 'prompts', label: 'Prompt Template Paths', hint: 'Paths to custom prompt templates', placeholder: './prompts/' },
    { key: 'themes', label: 'Theme Paths', hint: 'Paths to custom TUI themes', placeholder: './my-theme.json' },
  ]

  return (
    <div className="space-y-4">
      <Feedback feedback={feedback} />

      <Card>
        <CardTitle>Installed Packages <InfoTip text="Extensions, skills, and themes installed via pi install" /></CardTitle>
        <div className="flex gap-2 mb-3">
          <input
            className="bg-bg-elevated border border-border rounded-md px-3 py-1.5 text-text text-[13px] font-body outline-none flex-1 transition-colors focus-ring font-mono"
            placeholder="npm:package-name or git:github.com/user/repo"
            value={installInput}
            onChange={e => setInstallInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && installInput.trim()) installPkg(installInput.trim()) }}
          />
          <button
            className="px-3 py-1.5 rounded-md text-[13px] font-medium border border-accent text-accent bg-transparent cursor-pointer hover:bg-accent hover:text-white transition-all disabled:opacity-30"
            disabled={!installInput.trim() || !!installing}
            onClick={() => installPkg(installInput.trim())}
          >
            {installing === installInput.trim() ? '⏳' : '📦'} Install
          </button>
        </div>
        {installedPkgs.length === 0 ? (
          <div className="text-[13px] text-muted py-2">No packages installed</div>
        ) : (
          <div className="space-y-1">
            {installedPkgs.map(p => (
              <div key={p} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-bg-hover transition-colors group">
                <span className="text-[13px] font-mono text-text truncate flex-1" title={p}>{p}</span>
                <button
                  className="opacity-0 group-hover:opacity-100 px-2 py-0.5 rounded text-[12px] text-danger border border-danger/30 bg-transparent cursor-pointer hover:bg-danger-subtle transition-all"
                  onClick={() => removePkg(p)}
                  disabled={installing === p}
                >
                  {installing === p ? '⏳' : '✕'}
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Resource paths */}
      {resourceSections.map(({ key, label, hint, placeholder }) => (
        <Card key={key}>
          <CardTitle>{label} <InfoTip text={hint} /></CardTitle>
          <textarea
            className="w-full bg-bg-elevated border border-border rounded-md p-3 text-[13px] font-mono text-text resize-none outline-none focus-ring leading-relaxed min-h-[60px]"
            value={((settings[key] as string[]) || []).join('\n')}
            onChange={e => {
              const lines = e.target.value.split('\n').filter(l => l.trim())
              const next = { ...settings, [key]: lines.length ? lines : undefined }
              setSettings(next)
            }}
            onBlur={() => {
              fetch('/api/pi/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) })
            }}
            placeholder={placeholder}
            spellCheck={false}
          />
        </Card>
      ))}

      <Card>
        <CardTitle>
          Package Gallery <InfoTip text="Community packages from npmjs.com tagged with pi-package" />
          <a href="https://shittycodingagent.ai/packages" target="_blank" rel="noopener" className="text-[12px] text-accent ml-2 hover:underline">↗ Browse</a>
        </CardTitle>
        <SearchInput placeholder="Search packages…" value={galleryFilter} onChange={e => setGalleryFilter(e.target.value)} className="mb-3" />
        {galleryLoading ? (
          <div className="text-[13px] text-muted py-4 text-center">Loading gallery…</div>
        ) : (
          <div className="max-h-[400px] overflow-y-auto space-y-1">
            {filteredGallery.map(p => {
              const installed = isInstalled(p.name)
              const npmSource = `npm:${p.name}`
              return (
                <div key={p.name} className="flex items-start justify-between gap-3 py-2.5 px-2 rounded hover:bg-bg-hover transition-colors border-b border-border last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <a href={(() => { const r = p.links.repository?.replace(/^git\+/, '').replace(/\.git$/, '') || ''; return p.links.homepage || (r.startsWith('http') ? r : '') || p.links.npm || `https://www.npmjs.com/package/${p.name}` })()} target="_blank" rel="noopener" className="text-[13px] font-mono font-semibold text-text hover:text-accent transition-colors cursor-pointer">{p.name}</a>
                      <span className="text-[11px] text-muted font-mono">v{p.version}</span>
                      {installed && <Badge variant="ok">installed</Badge>}
                    </div>
                    <div className="text-[12px] text-muted mt-0.5 line-clamp-2">{p.description}</div>
                    {p.author && <div className="text-[11px] text-muted/60 mt-0.5">by {p.author}</div>}
                  </div>
                  <button
                    className={`px-2.5 py-1 rounded-md text-[12px] font-medium border cursor-pointer transition-all shrink-0 ${installed ? 'border-danger/30 text-danger bg-transparent hover:bg-danger-subtle' : 'border-accent text-accent bg-transparent hover:bg-accent hover:text-white'}`}
                    disabled={installing === npmSource}
                    onClick={() => installed ? removePkg(npmSource) : installPkg(npmSource)}
                  >
                    {installing === npmSource ? '⏳' : installed ? 'Remove' : 'Install'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

/* ── CHAT TAB ── */
function ChatTab() {
  const [config, setConfig] = useState<ChatConfig>(loadChatConfig)

  const set = <K extends keyof ChatConfig>(k: K, v: ChatConfig[K]) => {
    const next = { ...config, [k]: v }
    saveChatConfig(next)
    setConfig(next)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Chat Behavior</CardTitle>
        <div className="divide-y divide-border">
          <Toggle label="Show message timestamps" hint="Display time next to each message" checked={config.showTimestamps} onChange={v => set('showTimestamps', v)} />
          <Toggle label="Send on Enter" hint={config.sendOnEnter ? 'Shift+Enter for newline' : 'Click Send button to submit'} checked={config.sendOnEnter} onChange={v => set('sendOnEnter', v)} />
          <Toggle label="History expanded by default" hint="Auto-expand session history in sidebar" checked={config.historyExpanded} onChange={v => set('historyExpanded', v)} />
          <SelectRow label="Notification limit" hint="Max notifications to keep" value={String(config.notifLimit)} options={[
            { value: '25', label: '25' }, { value: '50', label: '50' },
            { value: '100', label: '100' }, { value: '200', label: '200' },
          ]} onChange={v => set('notifLimit', Number(v))} />
        </div>
      </Card>
    </div>
  )
}

/* ── DISPLAY TAB ── */
function DisplayTab() {
  const { preference, setTheme } = useTheme()

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Appearance</CardTitle>
        <div className="divide-y divide-border">
          <div className="flex items-center justify-between py-3">
            <div>
              <span className="text-[13px] text-text">Theme</span>
              <div className="text-[12px] text-muted/60 mt-0.5">Choose a theme for the dashboard</div>
            </div>
          </div>
          <div className="py-3">
            <SectionLabel>Base</SectionLabel>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {([
                { id: 'system' as const, label: '🖥 System', desc: 'Follow OS preference' },
                { id: 'dark' as const, label: '🌙 Dark', desc: 'Default dark theme' },
                { id: 'light' as const, label: '☀️ Light', desc: 'Default light theme' },
              ] as const).map(t => (
                <button
                  key={t.id}
                  className={`px-3 py-2.5 rounded-lg text-[13px] font-medium border cursor-pointer transition-all text-left ${preference === t.id ? 'bg-accent/10 text-accent border-accent/40 shadow-sm' : 'border-border text-muted bg-transparent hover:text-text hover:border-border-strong'}`}
                  onClick={() => setTheme(t.id)}
                >
                  <div>{t.label}</div>
                  <div className="text-[11px] text-muted/60 mt-0.5 font-normal">{t.desc}</div>
                </button>
              ))}
            </div>
            <SectionLabel>Rosé Pine</SectionLabel>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {([
                { id: 'rose-pine' as const, label: '🌸 Rosé Pine', desc: 'Soho vibes dark' },
                { id: 'rose-pine-moon' as const, label: '🌙 Moon', desc: 'Lighter dark variant' },
                { id: 'rose-pine-dawn' as const, label: '🌅 Dawn', desc: 'Warm light variant' },
              ] as const).map(t => (
                <button
                  key={t.id}
                  className={`px-3 py-2.5 rounded-lg text-[13px] font-medium border cursor-pointer transition-all text-left ${preference === t.id ? 'bg-accent/10 text-accent border-accent/40 shadow-sm' : 'border-border text-muted bg-transparent hover:text-text hover:border-border-strong'}`}
                  onClick={() => setTheme(t.id)}
                >
                  <div>{t.label}</div>
                  <div className="text-[11px] text-muted/60 mt-0.5 font-normal">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>Font</CardTitle>
        <div className="text-[13px] text-muted py-2">
          Body: <span className="font-mono text-text">Space Grotesk</span> · Code: <span className="font-mono text-text">JetBrains Mono</span>
        </div>
      </Card>
    </div>
  )
}

/* ── SKILLS TAB ── */
function SkillsTab() {
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [files, setFiles] = useState<string[]>([])
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  useEffect(() => { fetch('/api/skills').then(r => r.json()).then(setSkills).catch(() => {}) }, [])

  const selectSkill = useCallback(async (name: string) => {
    setSelected(name)
    setOpenFile(null)
    setContent('')
    setDirty(false)
    try {
      const d = await fetch(`/api/skills/${encodeURIComponent(name)}/files`).then(r => r.json())
      setFiles(d.files || [])
    } catch { setFiles([]) }
  }, [])

  const openSkillFile = useCallback(async (file: string) => {
    if (!selected) return
    setOpenFile(file)
    setDirty(false)
    try {
      const d = await fetch(`/api/skills/${encodeURIComponent(selected)}/file?path=${encodeURIComponent(file)}`).then(r => r.json())
      setContent(d.content || '')
    } catch { setContent('') }
  }, [selected])

  const save = useCallback(async () => {
    if (!selected || !openFile) return
    setSaving(true)
    try {
      await fetch(`/api/skills/${encodeURIComponent(selected)}/file`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: openFile, content }),
      }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`) })
      setDirty(false)
      setFeedback({ type: 'ok', msg: 'Saved' })
    } catch (e: any) { setFeedback({ type: 'err', msg: e.message || 'Save failed' }) }
    setSaving(false)
    setTimeout(() => setFeedback(null), 2000)
  }, [selected, openFile, content])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && dirty) { e.preventDefault(); save() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [dirty, save])

  return (
    <div className="space-y-4">
      <Feedback feedback={feedback} />
      <Card>
        <CardTitle>Skills <InfoTip text="Edit SKILL.md files and scripts in ~/.pi/agent/skills/" /></CardTitle>
        <div className="flex flex-col md:flex-row gap-4 min-h-[400px]">
          <div className="w-full md:w-48 shrink-0 md:border-r border-b md:border-b-0 border-border pb-3 md:pb-0 md:pr-3 overflow-y-auto max-h-[200px] md:max-h-[500px]">
            {skills.map(s => (
              <button key={s.name} onClick={() => selectSkill(s.name)}
                className={`w-full text-left px-2 py-1.5 rounded text-[13px] font-mono truncate cursor-pointer transition-colors ${
                  selected === s.name ? 'bg-accent-subtle text-accent' : 'text-text hover:bg-bg-hover'
                }`}
                title={s.description}
              >{s.name}</button>
            ))}
          </div>
          <div className="flex-1 min-w-0">
            {!selected ? (
              <div className="text-[13px] text-muted py-8 text-center">Select a skill to view its files</div>
            ) : !openFile ? (
              <div>
                <div className="text-[13px] text-muted mb-2">Files in <span className="font-mono text-text">{selected}/</span></div>
                {files.map(f => (
                  <button key={f} onClick={() => openSkillFile(f)}
                    className="block w-full text-left px-2 py-1.5 rounded text-[13px] font-mono text-accent hover:bg-bg-hover cursor-pointer transition-colors truncate"
                  >{f}</button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col h-full">
                <div className="flex items-center gap-2 mb-2">
                  <button onClick={() => { setOpenFile(null); setDirty(false) }}
                    className="text-[12px] text-muted hover:text-text cursor-pointer">← back</button>
                  <span className="text-[13px] font-mono text-text truncate">{selected}/{openFile}</span>
                  {dirty && <span className="text-[11px] text-warning">●</span>}
                  <button onClick={save} disabled={!dirty || saving}
                    className="ml-auto px-3 py-1 rounded-md text-[12px] font-medium border border-accent text-accent bg-transparent cursor-pointer hover:bg-accent hover:text-white transition-all disabled:opacity-30"
                  >{saving ? '⏳' : '💾'} Save</button>
                </div>
                <textarea
                  className="flex-1 min-h-[350px] w-full bg-bg-elevated border border-border rounded-md p-3 text-[13px] font-mono text-text resize-none outline-none focus-ring leading-relaxed"
                  value={content}
                  onChange={e => { setContent(e.target.value); setDirty(true) }}
                  spellCheck={false}
                />
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}

/* ── VAULT TAB ── */
interface DashConfig {
  vault: {
    path: string
    dirs: {
      daily: string
      tasks: string
      meetings: string
      people: string
      recipes: string
    }
  }
}

function VaultTab() {
  const [config, setConfig] = useState<DashConfig | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/dash/config').then(j).then(setConfig).catch(() => {})
  }, [])

  const save = useCallback(async (next: DashConfig) => {
    setSaving(true)
    setConfig(next)
    try {
      const saved = await fetch('/api/dash/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      }).then(j)
      setConfig(saved)
      setFeedback({ type: 'ok', msg: 'Saved' })
    } catch {
      setFeedback({ type: 'err', msg: 'Save failed' })
    }
    setSaving(false)
    setTimeout(() => setFeedback(null), 2000)
  }, [])

  if (!config) return <div className="text-muted text-[13px] py-4">Loading…</div>

  const setVaultPath = (path: string) => save({ ...config, vault: { ...config.vault, path } })
  const setDir = (key: string, value: string) => save({ ...config, vault: { ...config.vault, dirs: { ...config.vault.dirs, [key]: value } } })

  const dirFields: { key: string; label: string; hint: string }[] = [
    { key: 'daily', label: 'Daily Notes', hint: 'Folder containing daily .md files (e.g. 2026-04-17.md)' },
    { key: 'tasks', label: 'Task Notes', hint: 'Folder containing task notes' },
    { key: 'meetings', label: 'Meeting Notes', hint: 'Folder containing meeting notes' },
    { key: 'people', label: 'People', hint: 'Folder containing person notes' },
    { key: 'recipes', label: 'Recipes', hint: 'Folder containing recipes' },
  ]

  return (
    <div className="space-y-4">
      <Feedback feedback={feedback} />

      <Card>
        <CardTitle>Obsidian Vault Path <InfoTip text="Absolute path to your Obsidian vault directory. Leave empty to disable vault features." /></CardTitle>
        <div className="flex gap-2">
          <input
            className="flex-1 bg-bg-elevated border border-border rounded-md px-3 py-2 text-[13px] font-mono text-text outline-none focus-ring transition-colors"
            placeholder="/Users/you/Documents/MyVault"
            value={config.vault.path}
            onChange={e => setConfig({ ...config, vault: { ...config.vault, path: e.target.value } })}
            onBlur={e => {
              const trimmed = e.target.value.trim()
              if (trimmed !== config.vault.path) setVaultPath(trimmed)
            }}
            onKeyDown={e => { if (e.key === 'Enter') setVaultPath((e.target as HTMLInputElement).value.trim()) }}
          />
          <button
            className="px-3 py-2 rounded-md text-[13px] font-medium border border-accent text-accent bg-transparent cursor-pointer hover:bg-accent hover:text-white transition-all disabled:opacity-30"
            disabled={saving}
            onClick={() => setVaultPath(config.vault.path.trim())}
          >
            {saving ? '⏳' : '💾'} Save
          </button>
        </div>
        {config.vault.path && (
          <div className="text-[12px] text-muted mt-2">Stored in <span className="font-mono">~/.pi/dashboard.json</span></div>
        )}
      </Card>

      <Card>
        <CardTitle>Subdirectory Mapping <InfoTip text="Map vault features to the folder names in your vault. Paths are relative to the vault root." /></CardTitle>
        <div className="divide-y divide-border">
          {dirFields.map(({ key, label, hint }) => (
            <div key={key} className="flex items-center justify-between gap-4 py-2.5">
              <div>
                <span className="text-[13px] text-text">{label}</span>
                <div className="text-[12px] text-muted/60 mt-0.5">{hint}</div>
              </div>
              <input
                className="w-48 bg-bg-elevated border border-border rounded-md px-2.5 py-1.5 text-[13px] font-mono text-text outline-none focus-ring transition-colors text-right"
                value={(config.vault.dirs as any)[key] || ''}
                onChange={e => setConfig({ ...config, vault: { ...config.vault, dirs: { ...config.vault.dirs, [key]: e.target.value } } })}
                onBlur={e => setDir(key, e.target.value.trim())}
                onKeyDown={e => { if (e.key === 'Enter') setDir(key, (e.target as HTMLInputElement).value.trim()) }}
              />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

/* ── DEVELOPER TAB ── */
function DeveloperTab() {
  const [logLevel, setLogLevel] = useState('info')
  const [rawJson, setRawJson] = useState('')
  const [jsonDirty, setJsonDirty] = useState(false)
  const [jsonFeedback, setJsonFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const status = useAppSelector(s => s.dashboard.status)

  useEffect(() => {
    api.logLevel().then(d => setLogLevel(d.level || 'info')).catch(() => {})
    fetch('/api/pi/settings').then(r => r.json()).then(obj => { setRawJson(JSON.stringify(obj, null, 2)); setJsonDirty(false) }).catch(() => {})
  }, [])

  const changeLevel = useCallback(async (level: string) => {
    setLogLevel(level)
    await api.setLogLevel(level).catch(() => {})
  }, [])

  const saveRawJson = useCallback(async () => {
    try {
      JSON.parse(rawJson) // validate
      await fetch('/api/pi/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: rawJson })
      setJsonDirty(false)
      setJsonFeedback({ type: 'ok', msg: 'Saved' })
    } catch (e: any) {
      setJsonFeedback({ type: 'err', msg: e.message || 'Invalid JSON' })
    }
    setTimeout(() => setJsonFeedback(null), 3000)
  }, [rawJson])

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Diagnostics</CardTitle>
        <div className="divide-y divide-border">
          <SelectRow label="Log level" hint="Controls verbosity of log output" value={logLevel} options={[
            { value: 'debug', label: 'Debug' }, { value: 'info', label: 'Info' },
            { value: 'warn', label: 'Warn' }, { value: 'error', label: 'Error' },
          ]} onChange={changeLevel} />
          <div className="flex items-center justify-between py-2">
            <span className="text-[13px] text-text">Version</span>
            <span className="text-[13px] font-mono text-muted">{status?.version || '—'}</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-[13px] text-text">Platform</span>
            <span className="text-[13px] font-mono text-muted">{status?.platform || '—'}</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-[13px] text-text">Uptime</span>
            <span className="text-[13px] font-mono text-muted">{status?.uptime || '—'}</span>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>Actions</CardTitle>
        <div className="flex gap-2 flex-wrap">
          <button className="px-3 py-1.5 rounded-md border border-border bg-transparent text-muted text-[13px] cursor-pointer font-body hover:text-text hover:border-border-strong hover:bg-bg-hover transition-all" onClick={() => api.restartSessions()}>
            🔄 Restart Sessions
          </button>
        </div>
      </Card>

      <Card>
        <CardTitle>
          Raw settings.json
          <InfoTip text="Direct edit of ~/.pi/agent/settings.json — for advanced users" />
          {jsonDirty && <span className="text-[11px] text-warn ml-2">● unsaved</span>}
        </CardTitle>
        <Feedback feedback={jsonFeedback} />
        <textarea
          className="w-full bg-bg-elevated border border-border rounded-md p-3 text-[13px] font-mono text-text resize-none outline-none focus-ring leading-relaxed min-h-[300px] mt-2"
          value={rawJson}
          onChange={e => { setRawJson(e.target.value); setJsonDirty(true) }}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 's' && jsonDirty) { e.preventDefault(); saveRawJson() } }}
          spellCheck={false}
        />
        <div className="flex justify-end mt-2">
          <button
            className="px-3 py-1.5 rounded-md text-[13px] font-medium border border-accent text-accent bg-transparent cursor-pointer hover:bg-accent hover:text-white transition-all disabled:opacity-30"
            disabled={!jsonDirty}
            onClick={saveRawJson}
          >
            💾 Save JSON
          </button>
        </div>
      </Card>
    </div>
  )
}

/* ── SETTINGS PAGE ── */
export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('model')

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'model', label: 'Model', icon: '🤖' },
    { id: 'behavior', label: 'Behavior', icon: '⚙' },
    { id: 'terminal', label: 'Terminal', icon: '🖥' },
    { id: 'display', label: 'Display', icon: '🎨' },
    { id: 'chat', label: 'Chat', icon: '💬' },
    { id: 'general', label: 'Packages', icon: '📦' },
    { id: 'skills', label: 'Skills', icon: '🛠' },
    { id: 'vault', label: 'Vault', icon: '📁' },
    { id: 'developer', label: 'Developer', icon: '🔧' },
  ]

  return (
    <>
      <PageHeader title="Settings" subtitle="Configure Pi Dashboard and TUI preferences" />
      <div className="px-3 md:px-6 pb-8 overflow-y-auto flex-1 min-h-0">
        <div className="flex flex-wrap gap-1.5 mb-6 border-b border-border pb-3">
          {tabs.map(t => (
            <button
              key={t.id}
              className={`px-3 py-1.5 rounded-md text-[13px] font-medium cursor-pointer transition-all border ${tab === t.id ? 'bg-accent-subtle text-accent border-accent/30' : 'border-transparent text-muted bg-transparent hover:text-text hover:bg-bg-hover'}`}
              onClick={() => setTab(t.id)}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="max-w-2xl">
          {tab === 'model' && <ModelTab />}
          {tab === 'behavior' && <BehaviorTab />}
          {tab === 'terminal' && <TerminalTab />}
          {tab === 'general' && <GeneralTab />}
          {tab === 'skills' && <SkillsTab />}
          {tab === 'chat' && <ChatTab />}
          {tab === 'display' && <DisplayTab />}
          {tab === 'vault' && <VaultTab />}
          {tab === 'developer' && <DeveloperTab />}
        </div>
      </div>
    </>
  )
}
