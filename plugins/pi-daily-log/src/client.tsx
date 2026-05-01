// @ts-nocheck — Plugin files are bundled by Vite, not type-checked by the frontend tsc config.
/**
 * Pi Daily & Oncall Log plugin — rich rendering for log entry tools.
 */

interface ToolProps {
  toolName: string
  toolInput: Record<string, unknown>
  toolResult?: string
  isError?: boolean
  sessionId: string
}

function LogCard({ icon, title, entry, result, isError }: {
  icon: string; title: string; entry: string; result?: string; isError?: boolean
}) {
  // Parse "Logged to <path>:\n- <timestamp> — <entry>" from result
  const pathMatch = result?.match(/Logged to (.+?):/)
  const path = pathMatch?.[1]?.split('/').pop()

  return (
    <div className={`bg-card border rounded-lg overflow-hidden animate-scale-in ${isError ? 'border-danger/30' : 'border-border'}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-hover/50">
        <span className="text-[14px]">{icon}</span>
        <span className="text-[13px] font-semibold text-text">{title}</span>
        {path && <span className="text-[11px] text-muted font-mono ml-auto">{path}</span>}
        {!isError && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-ok/15 text-ok ml-auto">✓</span>
        )}
      </div>
      <div className="p-3">
        {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{result}</pre>}
        {!isError && (
          <div className="px-2 py-1.5 rounded bg-bg-hover/50 text-[13px] text-text/80">
            {entry}
          </div>
        )}
      </div>
    </div>
  )
}

export function DailyLogRenderer({ toolInput, toolResult, isError }: ToolProps) {
  return <LogCard icon="📓" title="Daily Log" entry={toolInput.entry as string || ''} result={toolResult} isError={isError} />
}

export function OncallLogRenderer({ toolInput, toolResult, isError }: ToolProps) {
  return <LogCard icon="🚨" title="Oncall Log" entry={toolInput.entry as string || ''} result={toolResult} isError={isError} />
}
