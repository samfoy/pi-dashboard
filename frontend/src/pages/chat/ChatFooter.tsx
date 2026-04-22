import { memo, useState, useEffect } from 'react'

const THINKING_LABELS = [
  'Preheating the oven…',
  'Kneading the dough…',
  'Letting it rise…',
  'Folding in the layers…',
  'Simmering ideas…',
  'Whisking it together…',
  'Adding a pinch of logic…',
  'Reducing the sauce…',
  'Checking the recipe…',
  'Rolling out the answer…',
  'Baking at 350°…',
  'Caramelizing thoughts…',
  'Proofing the response…',
  'Deglazing the pan…',
  'Tempering the chocolate…',
]

function useRotatingLabel(labels: string[], intervalMs = 4000) {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setIndex(i => (i + 1) % labels.length), intervalMs)
    return () => clearInterval(id)
  }, [labels.length, intervalMs])
  return labels[index]
}

function useElapsed() {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(id)
  }, [])
  return elapsed
}

const ChatFooter = memo(function ChatFooter({ running, stopping, state, lastRole }: { running: boolean; stopping: boolean; state: string; lastRole: string }) {
  const label = useRotatingLabel(THINKING_LABELS)
  const elapsed = useElapsed()

  if (!running || lastRole === 'streaming') return null

  const timer = elapsed >= 3
    ? <span className="text-muted/50 text-[12px] font-mono tabular-nums ml-2">{elapsed}s</span>
    : null

  return (
    <div className="flex gap-3 items-start mb-3 mr-4 px-5 animate-slide-up" role="status" aria-live="polite" aria-label={stopping ? 'Stopping' : state === 'tool_running' ? 'Running tool' : label}>
      <img src="/logo.png" alt="Pi Dashboard" className="w-8 h-8 rounded-md shrink-0 self-end mb-0.5 object-cover" />
      <div className="px-4 py-3 rounded-lg rounded-bl-[4px] bg-card border border-border shadow-[inset_0_1px_0_var(--card-hl)] min-w-[140px]">
        {stopping ? (
          <div className="flex items-center gap-2">
            <span className="inline-block w-4 h-4 border-2 border-muted/30 border-t-muted rounded-full animate-spin" />
            <span className="text-muted text-[13px]">Pulling from the oven…</span>
          </div>
        ) : state === 'tool_running' ? (
          <div className="flex items-center gap-2">
            <span className="inline-block w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            <span className="text-[13px] text-muted">Greasing the pan…</span>
            {timer}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-[3px]">
              <span className="block w-[6px] h-[6px] rounded-full bg-accent/70 animate-[pulse-dot_1.4s_ease-in-out_infinite]" />
              <span className="block w-[6px] h-[6px] rounded-full bg-accent/70 animate-[pulse-dot_1.4s_ease-in-out_0.2s_infinite]" />
              <span className="block w-[6px] h-[6px] rounded-full bg-accent/70 animate-[pulse-dot_1.4s_ease-in-out_0.4s_infinite]" />
            </div>
            <span className="text-[13px] text-muted transition-opacity duration-300">{label}</span>
            {timer}
          </div>
        )}
      </div>
    </div>
  )
})

export default ChatFooter
