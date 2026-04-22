import { memo } from 'react'

interface Props {
  content: string
  meta?: Record<string, unknown>
}

/** Parse process update messages like "[ad-process:update] Process 'wiki-deploy' completed successfully (1m 56s)" */
function parseProcessUpdate(content: string) {
  // Strip the [ad-process:*] prefix
  const text = content.replace(/^\[ad-process:[^\]]*\]\s*/, '')

  // Try to extract structured info
  const nameMatch = text.match(/Process '([^']+)'/)
  const name = nameMatch?.[1] ?? 'process'

  const isSuccess = /completed?\s*successfully|finished|done/i.test(text)
  const isFail = /failed|crashed|error|killed|exited/i.test(text)
  const isStart = /started|running|launched/i.test(text)

  const durationMatch = text.match(/\(([^)]*\d+[^)]*)\)\s*$/)
  const duration = durationMatch?.[1]

  // Extract output lines if present (after the first line)
  const lines = text.split('\n')
  const headline = lines[0]
  const output = lines.length > 1 ? lines.slice(1).join('\n').trim() : undefined

  return { name, isSuccess, isFail, isStart, duration, headline, output }
}

const SystemMessage = memo(function SystemMessage({ content, meta }: Props) {
  const customType = meta?.customType as string | undefined

  // Process updates get a styled notification bar
  if (customType?.startsWith('ad-process:')) {
    const { name, isSuccess, isFail, isStart, duration, output } = parseProcessUpdate(content)

    const colorClass = isSuccess ? 'border-ok/30 bg-ok/5' : isFail ? 'border-danger/30 bg-danger/5' : isStart ? 'border-accent/30 bg-accent/5' : 'border-border bg-card'
    const iconColorClass = isSuccess ? 'text-ok' : isFail ? 'text-danger' : isStart ? 'text-accent' : 'text-muted'
    const icon = isSuccess ? '✓' : isFail ? '✗' : isStart ? '▶' : '⚙'
    const statusLabel = isSuccess ? 'completed' : isFail ? 'failed' : isStart ? 'started' : 'update'

    return (
      <div className={`flex items-start gap-2.5 px-3.5 py-2.5 rounded-md border text-[13px] font-mono animate-scale-in ${colorClass}`}>
        <span className={`text-base leading-none mt-0.5 shrink-0 ${iconColorClass}`}>{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-text">{name}</span>
            <span className={`text-[12px] ${iconColorClass}`}>{statusLabel}</span>
            {duration && <span className="text-muted text-[12px]">({duration})</span>}
          </div>
          {output && (
            <pre className="mt-1.5 text-[12px] text-muted whitespace-pre-wrap break-all max-h-[120px] overflow-y-auto">{output}</pre>
          )}
        </div>
      </div>
    )
  }

  // Subagent updates
  if (customType?.startsWith('ad-subagent:')) {
    const text = content.replace(/^\[ad-subagent:[^\]]*\]\s*/, '')
    const isComplete = /complete|finished|done/i.test(text)
    const isFail = /failed|crashed|error/i.test(text)

    const colorClass = isComplete ? 'border-ok/30 bg-ok/5' : isFail ? 'border-danger/30 bg-danger/5' : 'border-accent/30 bg-accent/5'
    const icon = isComplete ? '✓' : isFail ? '✗' : '⧖'
    const iconColor = isComplete ? 'text-ok' : isFail ? 'text-danger' : 'text-accent'

    return (
      <div className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-md border text-[13px] font-mono animate-scale-in ${colorClass}`}>
        <span className={`text-base leading-none shrink-0 ${iconColor}`}>{icon}</span>
        <span className="text-text truncate">{text}</span>
      </div>
    )
  }

  // Generic system/custom message — simple muted bar
  const text = content.replace(/^\[[^\]]*\]\s*/, '')
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-md border border-border bg-card text-[13px] text-muted font-mono animate-scale-in">
      <span className="text-base leading-none shrink-0">ℹ</span>
      <span className="truncate">{text}</span>
    </div>
  )
})

export default SystemMessage
