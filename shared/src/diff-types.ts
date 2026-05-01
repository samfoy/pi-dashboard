/**
 * Types for the session file diff feature.
 */

/** A single edit operation (oldText → newText replacement) */
export interface EditOperation {
  oldText: string
  newText: string
}

/** An individual file change event extracted from session events */
export interface FileChangeEvent {
  type: 'edit' | 'write'
  timestamp: number
  /** Truncated assistant message preceding this change */
  message?: string
  edits?: EditOperation[]
  content?: string
}

/** A file entry with all its change events */
export interface FileDiffEntry {
  path: string
  changes: FileChangeEvent[]
  gitDiff?: string
}

/** Response from GET /api/slots/:key/diff */
export interface SessionDiffResponse {
  files: FileDiffEntry[]
  isGitRepo: boolean
}
