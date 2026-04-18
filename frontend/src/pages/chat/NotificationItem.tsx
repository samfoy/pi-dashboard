import type { Notification } from '../../types'

export default function NotificationItem({ n, active, onOpen, onDelete }: { n: Notification; active?: boolean; onOpen?: () => void; onDelete: (ts: string) => void }) {
  const acked = n.acked
  return (
    <div
      className={`group p-2 px-2.5 rounded-md mb-1 text-[13px] border bg-card cursor-pointer transition-all animate-slide-in-left hover:border-border-strong hover:bg-bg-hover ${acked ? 'opacity-50' : ''} ${active ? 'border-accent bg-accent-subtle' : n.kind === 'approval' || n.kind === 'input_needed' ? 'border-l-[3px] border-l-warn border-border' : n.kind === 'cron' ? 'border-l-[3px] border-l-accent border-border' : 'border-l-[3px] border-l-info border-border'}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.() } }}
      aria-label={n.title}
      title={n.title}
    >
      <div className="font-semibold text-text-strong text-[13px] mb-0.5 flex items-start gap-1.5">
        <span className="shrink-0 mt-0.5">{acked ? '✅' : n.kind === 'cron' ? '⏰' : n.kind === 'approval' ? '🔐' : n.kind === 'input_needed' ? '💬' : n.kind === 'tool_done' ? '🔧' : '🤖'}</span>
        <span className="break-words line-clamp-2 min-w-0 flex-1">{n.title}</span>
        <span className="opacity-0 group-hover:opacity-40 cursor-pointer text-[12px] shrink-0 mt-0.5 hover:!opacity-100 hover:text-danger transition-opacity" onClick={(e) => { e.stopPropagation(); onDelete(n.ts) }}>✕</span>
      </div>
      <div className="text-muted text-[12px] ml-[22px]">{acked ? 'Acknowledged' : (n.body || '').slice(0, 100)}{!acked && (n.body || '').length > 100 ? ' …' : ''}</div>
    </div>
  )
}
