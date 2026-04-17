import { useState, useCallback } from 'react'

export interface VersionMeta {
  version: number
  timestamp: string
  size: number
}

export interface Comment {
  id: string
  startLine: number
  endLine: number
  content: string
  version: number
  createdAt: string
  /** For non-text files: page number, paragraph index, cell ref, etc. */
  anchor?: string
}

export type FileType = 'text' | 'pdf' | 'docx' | 'spreadsheet' | 'image' | 'unknown'

const EXT_MAP: Record<string, FileType> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'spreadsheet',
  '.xls': 'spreadsheet',
  '.csv': 'spreadsheet',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.svg': 'image',
}

const TEXT_EXTS = new Set([
  '.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.py', '.json', '.yaml', '.yml',
  '.toml', '.sh', '.css', '.html', '.xml', '.rs', '.java', '.go', '.rb', '.sql',
  '.kt', '.cfg', '.env', '.ini', '.conf', '.log',
])

export function detectFileType(path: string): FileType {
  const dot = path.lastIndexOf('.')
  if (dot === -1) return 'text'
  const ext = path.slice(dot).toLowerCase()
  if (EXT_MAP[ext]) return EXT_MAP[ext]
  if (TEXT_EXTS.has(ext)) return 'text'
  return 'text'
}

export function usePanelState() {
  const [isOpen, setIsOpen] = useState(false)
  const [filePath, setFilePath] = useState('')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [conflictContent, setConflictContent] = useState<string | null>(null)
  const [versions, setVersions] = useState<VersionMeta[]>([])
  const [selectedVersion, selectVersion] = useState<number | null>(null)
  const [diffMode, setDiffMode] = useState(false)
  const [diffBase, setDiffBase] = useState<number | null>(null)
  const [comments, setComments] = useState<Comment[]>([])

  const openPanel = useCallback((fp: string, c: string) => {
    setFilePath(fp); setContent(c); setIsOpen(true)
    setDirty(false); setConflictContent(null)
    setVersions([]); selectVersion(null)
    setDiffMode(false); setDiffBase(null); setComments([])
  }, [])

  const closePanel = useCallback(() => {
    setIsOpen(false); setFilePath(''); setContent('')
  }, [])

  const toggleDiffMode = useCallback(() => setDiffMode(v => !v), [])

  const resolveConflict = useCallback((action: 'reload' | 'keep' | 'diff') => {
    if (action === 'reload') {
      setContent(conflictContent ?? '')
      setDirty(false)
      setConflictContent(null)
    } else if (action === 'keep') {
      setConflictContent(null)
    }
  }, [conflictContent])

  return {
    isOpen, filePath, content, openPanel, closePanel, setContent,
    dirty, setDirty, conflictContent, setConflictContent,
    versions, setVersions, selectedVersion, selectVersion,
    diffMode, toggleDiffMode, diffBase, setDiffBase,
    comments, setComments, resolveConflict,
  }
}
