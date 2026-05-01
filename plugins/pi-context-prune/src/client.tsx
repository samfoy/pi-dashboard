// @ts-nocheck — Plugin files are bundled by Vite, not type-checked by the frontend tsc config.
/**
 * Pi Context Prune plugin — rich rendering for context_prune tool results.
 */

interface ToolProps {
  toolName: string
  toolInput: Record<string, unknown>
  toolResult?: string
  isError?: boolean
  sessionId: string
}

export function ContextPruneRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const summary = toolInput.summary as string || ''
  const toolName = toolInput.tool_name as string
  const toolUseId = toolInput.tool_use_id as string

  return (
    <div className={`bg-card border rounded-lg overflow-hidden animate-scale-in ${isError ? 'border-danger/30' : 'border-border'}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-hover/50">
        <span className="text-[14px]">✂️</span>
        <span className="text-[13px] font-semibold text-text">Context Pruned</span>
        {toolName && <span className="text-[11px] text-muted font-mono">{toolName}</span>}
        {!isError && (
          <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-ok/15 text-ok">✓</span>
        )}
      </div>
      <div className="p-3">
        {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
        {!isError && (
          <div className="px-2 py-1.5 rounded bg-bg-hover/50 text-[13px] text-text/80 italic">
            {summary}
          </div>
        )}
      </div>
    </div>
  )
}
