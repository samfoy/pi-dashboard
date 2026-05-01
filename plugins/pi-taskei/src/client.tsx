// @ts-nocheck — Plugin files are bundled by Vite, not type-checked by the frontend tsc config.
/**
 * Pi Taskei plugin — rich rendering for Taskei task management tools.
 */
import { useState } from 'react'

interface ToolProps {
  toolName: string
  toolInput: Record<string, unknown>
  toolResult?: string
  isError?: boolean
  sessionId: string
}

function CardShell({ icon, title, subtitle, badge, children, isError }: {
  icon: string; title: string; subtitle?: string; badge?: React.ReactNode; children: React.ReactNode; isError?: boolean
}) {
  return (
    <div className={`bg-card border rounded-lg overflow-hidden animate-scale-in ${isError ? 'border-danger/30' : 'border-border'}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-hover/50">
        <span className="text-[14px]">{icon}</span>
        <span className="text-[13px] font-semibold text-text">{title}</span>
        {subtitle && <span className="text-[11px] text-muted truncate">{subtitle}</span>}
        {badge && <span className="ml-auto shrink-0">{badge}</span>}
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}

function tryParseJSON(text: string): any {
  try { return JSON.parse(text) } catch { return null }
}

const statusColors: Record<string, string> = {
  Open: 'bg-accent/15 text-accent',
  'In Progress': 'bg-warn/15 text-warn',
  Closed: 'bg-ok/15 text-ok',
  Blocked: 'bg-danger/15 text-danger',
}

const priorityColors: Record<string, string> = {
  Critical: 'text-danger',
  High: 'text-warn',
  Medium: 'text-text',
  Low: 'text-muted',
}

// ── TaskeiListTasks ──────────────────────────────────────────────────────────

export function TaskeiListRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const [expanded, setExpanded] = useState(true)
  const data = tryParseJSON(toolResult || '')
  const tasks = Array.isArray(data) ? data : data?.tasks || data?.items || []

  return (
    <CardShell icon="📋" title="Tasks" badge={
      tasks.length > 0 ? <span className="text-[11px] text-muted">{tasks.length} tasks</span> : null
    } isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && tasks.length === 0 && <p className="text-muted text-[13px] italic">{toolResult || 'No tasks found.'}</p>}
      {!isError && tasks.length > 0 && (
        <div className="space-y-1">
          <button onClick={() => setExpanded(!expanded)} className="text-[11px] text-muted hover:text-text bg-transparent border-none cursor-pointer">
            {expanded ? '▼' : '▶'} {tasks.length} task{tasks.length !== 1 ? 's' : ''}
          </button>
          {expanded && tasks.map((t: any, i: number) => (
            <div key={i} className="flex items-start gap-2 px-2 py-1.5 rounded bg-bg-hover/50 text-[13px]">
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${statusColors[t.status] || 'bg-bg-hover text-muted'}`}>
                {t.status || '?'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-text truncate">{t.name || t.title || t.id}</div>
                {t.assignee && <span className="text-[11px] text-muted">👤 {t.assignee}</span>}
              </div>
              {t.priority && <span className={`text-[11px] shrink-0 ${priorityColors[t.priority] || 'text-muted'}`}>{t.priority}</span>}
              {t.id && <span className="text-[10px] text-muted/50 font-mono shrink-0">{t.id}</span>}
            </div>
          ))}
        </div>
      )}
    </CardShell>
  )
}

// ── TaskeiGetTask ────────────────────────────────────────────────────────────

export function TaskeiGetRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const taskId = toolInput.taskId as string || ''
  const data = tryParseJSON(toolResult || '')
  const task = data?.task || data || {}

  return (
    <CardShell icon="📌" title={task.name || task.title || `Task ${taskId}`} subtitle={taskId}
      badge={task.status ? <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${statusColors[task.status] || 'bg-bg-hover text-muted'}`}>{task.status}</span> : null}
      isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && !data && <pre className="text-muted text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && data && (
        <div className="space-y-2">
          {task.description && <p className="text-[13px] text-text/80">{task.description}</p>}
          <div className="flex flex-wrap gap-3 text-[12px]">
            {task.assignee && <span className="text-muted">👤 {task.assignee}</span>}
            {task.priority && <span className={priorityColors[task.priority] || 'text-muted'}>⚡ {task.priority}</span>}
            {task.type && <span className="text-muted">📎 {task.type}</span>}
            {task.estimatedCompletionDate && <span className="text-muted">📅 {task.estimatedCompletionDate.split('T')[0]}</span>}
          </div>
          {task.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {task.tags.map((tag: string, i: number) => (
                <span key={i} className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[10px] font-medium">{tag}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </CardShell>
  )
}

// ── TaskeiUpdateTask ─────────────────────────────────────────────────────────

export function TaskeiUpdateRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const id = toolInput.id as string || ''
  const status = toolInput.status as string
  const comment = toolInput.postCommentMessage as string

  return (
    <CardShell icon="✏️" title="Update Task" subtitle={id}
      badge={!isError ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-ok/15 text-ok">✓ Updated</span> : null}
      isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && (
        <div className="space-y-1.5">
          {status && <div className="text-[13px]">Status → <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${statusColors[status] || 'bg-bg-hover text-muted'}`}>{status}</span></div>}
          {comment && <div className="px-2 py-1.5 rounded bg-bg-hover/50 text-[13px] text-text/80 italic">💬 {comment}</div>}
          {!status && !comment && <p className="text-muted text-[13px]">{toolResult}</p>}
        </div>
      )}
    </CardShell>
  )
}

// ── TaskeiCreateTask ─────────────────────────────────────────────────────────

export function TaskeiCreateRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const name = toolInput.name as string || ''

  return (
    <CardShell icon="➕" title="Create Task"
      badge={!isError ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-ok/15 text-ok">✓ Created</span> : null}
      isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && (
        <div className="space-y-1.5">
          <div className="text-[14px] font-medium text-text">{name}</div>
          <p className="text-muted text-[12px]">{toolResult}</p>
        </div>
      )}
    </CardShell>
  )
}

// ── TaskeiGetRooms ───────────────────────────────────────────────────────────

export function TaskeiRoomsRenderer({ toolResult, isError }: ToolProps) {
  const data = tryParseJSON(toolResult || '')
  const rooms = Array.isArray(data) ? data : data?.rooms || []

  return (
    <CardShell icon="🏠" title="Taskei Rooms" badge={
      rooms.length > 0 ? <span className="text-[11px] text-muted">{rooms.length}</span> : null
    } isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && rooms.length === 0 && <pre className="text-muted text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && rooms.length > 0 && (
        <div className="space-y-1">
          {rooms.map((r: any, i: number) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded bg-bg-hover/50 text-[13px]">
              <span className="text-text font-medium">{r.name || r.title}</span>
              {r.id && <span className="text-[10px] text-muted/50 font-mono ml-auto">{r.id}</span>}
            </div>
          ))}
        </div>
      )}
    </CardShell>
  )
}
