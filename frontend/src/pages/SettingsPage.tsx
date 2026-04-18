import { useState, useEffect, useCallback } from 'react'
import { PageHeader, Card, CardTitle, SearchInput, Badge } from '../components/ui'
import InfoTip from '../components/InfoTip'
import { api, j } from '../api/client'
import { useAppSelector } from '../store'
import { useTheme } from '../hooks/useTheme'
import { loadChatConfig, saveChatConfig, type ChatConfig } from './chat/ChatSettings'

type Tab = 'general' | 'skills' | 'chat' | 'display' | 'developer'

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

interface PiSettings {
  defaultProvider?: string
  defaultModel?: string
  enabledModels?: string[]
  packages?: (string | object)[]
  defaultThinkingLevel?: string
  hideThinkingBlock?: boolean
  enableSkillCommands?: boolean
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

  const saveSetting = useCallback(async (key: string, value: unknown) => {
    if (!settings) return
    const next = { ...settings, [key]: value }
    setSettings(next)
    try {
      await fetch('/api/pi/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
      setFeedback({ type: 'ok', msg: 'Saved' })
    } catch { setFeedback({ type: 'err', msg: 'Save failed' }) }
    setTimeout(() => setFeedback(null), 2000)
  }, [settings])

  const installedPkgs = (settings?.packages || []).map(p => typeof p === 'string' ? p : (p as any).source || JSON.stringify(p))

  const installPkg = useCallback(async (source: string) => {
    setInstalling(source)
    setFeedback(null)
    try {
      await fetch('/api/pi/packages/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source }) }).then(j)
      setFeedback({ type: 'ok', msg: `Installed ${source}` })
      // Reload settings
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

  return (
    <div className="space-y-4">
      {feedback && (
        <div className={`px-3 py-2 rounded-md text-[13px] font-medium animate-scale-in ${feedback.type === 'ok' ? 'bg-ok-subtle text-ok border border-ok/20' : 'bg-danger-subtle text-danger border border-danger/20'}`}>
          {feedback.msg}
        </div>
      )}

      <Card>
        <CardTitle>Model Configuration <InfoTip text="Default model and provider from ~/.pi/agent/settings.json" /></CardTitle>
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
            options={(settings.enabledModels || []).map(m => ({ value: m.split('/').pop() || m, label: m }))}
            onChange={v => saveSetting('defaultModel', v)}
          />
          <SelectRow
            label="Thinking Level"
            hint="Controls depth of reasoning"
            value={settings.defaultThinkingLevel || 'medium'}
            options={[
              { value: 'none', label: 'None' },
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ]}
            onChange={v => saveSetting('defaultThinkingLevel', v)}
          />
          <Toggle label="Hide thinking blocks" hint="Collapse thinking in TUI" checked={settings.hideThinkingBlock ?? false} onChange={v => saveSetting('hideThinkingBlock', v)} />
          <Toggle label="Skill commands" hint="Enable /skill slash commands" checked={settings.enableSkillCommands ?? true} onChange={v => saveSetting('enableSkillCommands', v)} />
        </div>
      </Card>

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

function DisplayTab() {
  const { preference, cycle: cycleTheme } = useTheme()

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Appearance</CardTitle>
        <div className="divide-y divide-border">
          <div className="flex items-center justify-between py-3">
            <div>
              <span className="text-[13px] text-text">Theme</span>
              <div className="text-[12px] text-muted/60 mt-0.5">Switch between dark, light, and system</div>
            </div>
            <div className="flex gap-1.5">
              {(['dark', 'light', 'system'] as const).map(t => (
                <button
                  key={t}
                  className={`px-3 py-1.5 rounded-md text-[13px] font-medium border cursor-pointer transition-all ${preference === t ? 'bg-accent text-white border-accent' : 'border-border text-muted bg-transparent hover:text-text hover:border-border-strong'}`}
                  onClick={() => { if (preference !== t) cycleTheme() }}
                >
                  {t === 'dark' ? '🌙 Dark' : t === 'light' ? '☀ Light' : '🖥 System'}
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

  // Ctrl+S handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && dirty) { e.preventDefault(); save() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [dirty, save])

  return (
    <div className="space-y-4">
      {feedback && (
        <div className={`px-3 py-2 rounded-md text-[13px] font-medium animate-scale-in ${feedback.type === 'ok' ? 'bg-ok-subtle text-ok border border-ok/20' : 'bg-danger-subtle text-danger border border-danger/20'}`}>
          {feedback.msg}
        </div>
      )}
      <Card>
        <CardTitle>Skills <InfoTip text="Edit SKILL.md files and scripts in ~/.pi/agent/skills/" /></CardTitle>
        <div className="flex flex-col md:flex-row gap-4 min-h-[400px]">
          {/* Skill list */}
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
          {/* File list + editor */}
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

function DeveloperTab() {
  const [logLevel, setLogLevel] = useState('info')
  const status = useAppSelector(s => s.dashboard.status)

  useEffect(() => {
    api.logLevel().then(d => setLogLevel(d.level || 'info')).catch(() => {})
  }, [])

  const changeLevel = useCallback(async (level: string) => {
    setLogLevel(level)
    await api.setLogLevel(level).catch(() => {})
  }, [])

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
    </div>
  )
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('general')

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'general', label: 'General', icon: '⚙' },
    { id: 'skills', label: 'Skills', icon: '🛠' },
    { id: 'chat', label: 'Chat', icon: '💬' },
    { id: 'display', label: 'Display', icon: '🎨' },
    { id: 'developer', label: 'Developer', icon: '🔧' },
  ]

  return (
    <>
      <PageHeader title="Settings" subtitle="Configure Pi Dashboard preferences" />
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
          {tab === 'general' && <GeneralTab />}
          {tab === 'skills' && <SkillsTab />}
          {tab === 'chat' && <ChatTab />}
          {tab === 'display' && <DisplayTab />}
          {tab === 'developer' && <DeveloperTab />}
        </div>
      </div>
    </>
  )
}
