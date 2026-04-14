import type React from 'react'

/* ── Shared UI primitives ── */

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`card-glow border border-border bg-card rounded-lg p-5 mb-4 animate-rise shadow-sm hover:border-border-strong hover:shadow-md transition-all ${className}`}>
      {children}
    </div>
  )
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold tracking-tight text-text-strong mb-3.5 flex items-center gap-2">{children}</h3>
}

export function Btn({ children, onClick, danger, disabled, className = '' }: { children: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; className?: string }) {
  return (
    <button
      className={`px-2.5 py-1 rounded-md border border-border bg-transparent text-muted text-[13px] cursor-pointer font-body transition-all disabled:opacity-30 disabled:cursor-not-allowed ${danger ? 'hover:text-danger hover:border-danger' : 'hover:text-text hover:border-border-strong hover:bg-bg-hover'} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

export function SendBtn({ children, onClick, disabled, style }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; style?: React.CSSProperties }) {
  return (
    <button
      className="btn-sweep bg-accent text-white border-none rounded-lg px-4 h-9 text-sm font-semibold cursor-pointer hover:bg-accent-hover hover:shadow-[0_0_20px_var(--accent-glow)] disabled:opacity-30 disabled:cursor-not-allowed transition-all font-body"
      onClick={onClick}
      disabled={disabled}
      style={style}
    >
      {children}
    </button>
  )
}

export function Input({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`bg-bg-elevated border border-border rounded-md px-3 py-2 text-text text-sm font-body outline-none flex-1 transition-colors focus-ring ${className}`}
      {...props}
    />
  )
}

export function SearchInput({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`relative ${className}`}>
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted text-[12px] pointer-events-none">🔍</span>
      <input
        className="w-full bg-bg-elevated border border-border rounded-md pl-7 pr-3 py-1.5 text-text text-[13px] font-body outline-none transition-all focus-ring placeholder:text-muted/50"
        {...props}
      />
    </div>
  )
}

export function Badge({ variant, children }: { variant: 'ok' | 'err' | 'warn' | 'aim'; children: React.ReactNode }) {
  const cls =
    variant === 'ok' ? 'bg-ok-subtle text-ok'
    : variant === 'err' ? 'bg-danger-subtle text-danger'
    : variant === 'aim' ? 'bg-aim-subtle text-aim'
    : 'bg-warn-subtle text-warn'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-[13px] font-medium font-mono hover:scale-105 transition-transform ${cls}`}>
      {children}
    </span>
  )
}

export function AimBadge({ source }: { source: string }) {
  const cls =
    source === 'aim' ? 'bg-aim-subtle text-aim border-aim/30'
    : source === 'pi' ? 'bg-accent-subtle text-accent border-accent/30'
    : 'bg-bg-elevated text-muted border-border'
  return <span className={`px-1.5 py-[2px] rounded-full text-[11px] font-bold border shrink-0 ${cls}`}>{source}</span>
}

export function StatCard({ label, value, accent, colorClass, delay }: { label: string; value?: string | number | null; accent?: boolean; colorClass?: string; delay?: number }) {
  const loading = value === undefined || value === null
  return (
    <div
      className="stat-accent relative overflow-hidden bg-card rounded-md px-4 py-3.5 border border-border shadow-[inset_0_1px_0_var(--card-hl)] animate-rise hover:border-border-strong hover:-translate-y-0.5 hover:shadow-md transition-all"
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      <div className="text-muted text-[13px] font-medium uppercase tracking-[.04em]">{label}</div>
      {loading
        ? <div className="skeleton h-7 w-16 mt-1.5 rounded" />
        : <div className={`text-2xl font-bold mt-1.5 tracking-tight leading-none ${accent ? 'text-accent' : colorClass || ''}`}>{value ?? '—'}</div>
      }
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />
}

export function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2 animate-rise">
      <div className="text-[40px] opacity-[.12] select-none">{icon}</div>
      <div className="text-muted text-sm font-medium">{title}</div>
      {subtitle && <div className="text-muted/60 text-[13px]">{subtitle}</div>}
    </div>
  )
}

export function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-end justify-between gap-4 px-6 pt-4 pb-3">
      <div>
        <div className="text-2xl font-bold tracking-tight text-text-strong">{title}</div>
        <div className="text-muted text-sm mt-1">{subtitle}</div>
      </div>
    </div>
  )
}
