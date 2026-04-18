import { useState, useEffect, useCallback, useMemo } from 'react'

interface TreeEntry {
  id: string
  parentId: string | null
  type: string
  role: string
  text: string
  fullText?: string
  timestamp: string
  tools?: string[]
}

interface TreeNode extends TreeEntry {
  children: TreeNode[]
  depth: number
  isLeaf: boolean
  isActive: boolean
}

function buildTree(entries: TreeEntry[], leafId: string | null): TreeNode[] {
  const byId = new Map<string, TreeEntry>()
  const childMap = new Map<string | null, TreeEntry[]>()
  for (const e of entries) {
    byId.set(e.id, e)
    const pid = e.parentId || null
    if (!childMap.has(pid)) childMap.set(pid, [])
    childMap.get(pid)!.push(e)
  }

  // Find active path from leaf
  const activePath = new Set<string>()
  let cur = leafId
  while (cur) {
    activePath.add(cur)
    cur = byId.get(cur)?.parentId || null
  }

  function build(parentId: string | null, depth: number): TreeNode[] {
    const children = childMap.get(parentId) || []
    // Sort: active branch first, then by timestamp
    children.sort((a, b) => {
      const aActive = activePath.has(a.id) ? 0 : 1
      const bActive = activePath.has(b.id) ? 0 : 1
      if (aActive !== bActive) return aActive - bActive
      return (a.timestamp || '').localeCompare(b.timestamp || '')
    })
    return children.map(e => {
      const kids = build(e.id, depth + 1)
      return {
        ...e,
        children: kids,
        depth,
        isLeaf: e.id === leafId,
        isActive: activePath.has(e.id),
      }
    })
  }

  return build(null, 0)
}

function flattenVisible(nodes: TreeNode[], filter: 'all' | 'user'): TreeNode[] {
  const result: TreeNode[] = []
  function walk(nodes: TreeNode[]) {
    for (const n of nodes) {
      if (filter === 'all' || n.role === 'user') result.push(n)
      walk(n.children)
    }
  }
  walk(nodes)
  return result
}

// Has branch = parent has multiple children
function isBranchPoint(node: TreeNode, tree: TreeNode[]): boolean {
  // Walk tree to find parent and check sibling count
  function findParentChildCount(nodes: TreeNode[], targetParentId: string | null): number {
    if (targetParentId === null) return nodes.length
    function search(nodes: TreeNode[]): number {
      for (const n of nodes) {
        if (n.id === targetParentId) return n.children.length
        const r = search(n.children)
        if (r > 0) return r
      }
      return 0
    }
    return search(nodes)
  }
  return findParentChildCount(tree, node.parentId) > 1
}

const ROLE_ICONS: Record<string, string> = {
  user: '👤',
  assistant: '🤖',
  toolResult: '🔧',
  compaction: '📦',
  branchSummary: '📋',
  system: '⚙',
}

function TreeRow({ node, selected, onSelect, hasBranch }: {
  node: TreeNode; selected: boolean; onSelect: () => void; hasBranch: boolean
}) {
  const icon = ROLE_ICONS[node.role] || '·'
  const indent = Math.min(node.depth, 8) * 16

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors border-none ${
        selected ? 'bg-accent-subtle border-accent/30' : 'bg-transparent hover:bg-bg-hover'
      }`}
      style={{ paddingLeft: indent + 8 }}
    >
      {hasBranch && <span className="text-[10px] text-warning shrink-0 mt-0.5">⑂</span>}
      <span className="text-[12px] shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <span className={`text-[12px] font-mono truncate block ${
          node.isActive ? 'text-text' : 'text-muted'
        } ${node.isLeaf ? 'font-semibold text-accent' : ''}`}>
          {node.text || node.type}
        </span>
        {node.tools && node.tools.length > 0 && (
          <span className="text-[10px] text-muted/60 truncate block">
            {node.tools.join(', ')}
          </span>
        )}
      </div>
      {node.isLeaf && <span className="text-[10px] text-accent shrink-0 mt-0.5">← active</span>}
    </button>
  )
}

export default function SessionTree({ slotKey, onFork, onClose }: {
  slotKey: string
  onFork: (newSlotKey: string, text: string) => void
  onClose: () => void
}) {
  const [entries, setEntries] = useState<TreeEntry[]>([])
  const [leafId, setLeafId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'user'>('user')
  const [loading, setLoading] = useState(true)
  const [forking, setForking] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/chat/slots/${encodeURIComponent(slotKey)}/tree`)
      .then(r => r.json())
      .then(d => { setEntries(d.entries || []); setLeafId(d.leafId || null) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [slotKey])

  const tree = useMemo(() => buildTree(entries, leafId), [entries, leafId])
  const visible = useMemo(() => flattenVisible(tree, filter), [tree, filter])

  const handleFork = useCallback(async () => {
    if (!selected) return
    const entry = entries.find(e => e.id === selected)
    if (!entry || entry.role !== 'user') return
    setForking(true)
    try {
      const r = await fetch(`/api/chat/slots/${encodeURIComponent(slotKey)}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId: selected }),
      }).then(r => r.json())
      if (r.ok && r.newSlotKey) {
        onFork(r.newSlotKey, r.text || '')
      }
    } catch {}
    setForking(false)
  }, [selected, slotKey, entries, onFork])

  const selectedEntry = entries.find(e => e.id === selected)
  const canFork = selectedEntry?.role === 'user'

  if (loading) {
    return (
      <div className="p-4 text-[13px] text-muted text-center">Loading session tree…</div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <span className="text-[13px] font-medium text-text">🌳 Session Tree</span>
        <span className="text-[11px] text-muted">{entries.length} entries</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setFilter(f => f === 'all' ? 'user' : 'all')}
            className={`px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors border ${
              filter === 'user' ? 'border-accent/30 text-accent bg-accent-subtle' : 'border-border text-muted bg-transparent hover:text-text'
            }`}
          >
            {filter === 'user' ? '👤 User only' : '📋 All'}
          </button>
          <button onClick={onClose} className="px-2 py-0.5 rounded text-[11px] text-muted hover:text-text cursor-pointer bg-transparent border border-border transition-colors">✕</button>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-1 py-1">
        {visible.length === 0 ? (
          <div className="text-[13px] text-muted text-center py-8">No entries</div>
        ) : (
          visible.map(node => (
            <TreeRow
              key={node.id}
              node={node}
              selected={selected === node.id}
              onSelect={() => setSelected(node.id)}
              hasBranch={isBranchPoint(node, tree)}
            />
          ))
        )}
      </div>

      {/* Footer — fork action */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border shrink-0">
        {selected && selectedEntry ? (
          <>
            <span className="text-[12px] text-muted truncate flex-1">
              {ROLE_ICONS[selectedEntry.role] || '·'} {selectedEntry.text?.slice(0, 80) || selectedEntry.type}
            </span>
            {canFork && (
              <button
                onClick={handleFork}
                disabled={forking}
                className="px-3 py-1 rounded-md text-[12px] font-medium border border-accent text-accent bg-transparent cursor-pointer hover:bg-accent hover:text-white transition-all disabled:opacity-30"
              >
                {forking ? '⏳ Forking…' : '⑂ Fork from here'}
              </button>
            )}
          </>
        ) : (
          <span className="text-[12px] text-muted">Select a user message to fork from</span>
        )}
      </div>
    </div>
  )
}
