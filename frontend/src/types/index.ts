export interface StatusData {
  uptime: string
  start_time?: number
  sessions: number
  messages: number
  tool_calls?: number
  cron_jobs: number
  subagents: number
  lessons: number
  update_available?: boolean
  version?: string
  platform?: string
  cwd?: string
  yolo?: boolean
}

export interface MidwayTTL {
  valid: boolean
  message: string
  minutes_remaining: number | null
}

export interface SystemData {
  hostname: string; os: string; arch: string; cpu_count: number
  load_1m: number; load_5m: number; load_15m: number; cpu_pct: number
  mem_total_gb: number; mem_used_gb: number; mem_free_gb: number
  ip: string; net_rx_mb: number; net_tx_mb: number
  net_rx_kbs: number; net_tx_kbs: number
  disk_total_gb: number; disk_free_gb: number
  python: string; pid: number; cwd: string
  proc_mem_mb: number; proc_cpu_pct: number
  child_processes: number; thread_count: number
  ollama_running?: boolean; ollama_pid?: number; ollama_mem_mb?: number; ollama_remote?: boolean
}

export interface CronJob {
  id: string; name: string; message: string
  enabled: boolean; schedule: string; last_status: string
  agent?: string
}

export interface Lesson {
  rule: string; category: string; ts: string
}

export interface Skill {
  key: string; name: string; description: string; always?: boolean; source?: string; package?: string
}

export interface McpServer {
  name: string; command: string; args?: string[]
  status: string; error?: string; tools?: string[]
  source: string; enabled: boolean; disabledTools?: string[]
}

export interface ChatSlot {
  model?: string; cwd?: string;
  key: string; title: string; messages: number
  tool_calls?: number; running: boolean; stopping?: boolean; pending_approval?: boolean; created?: string; agent?: string; workspace?: string; trust?: boolean
}

export interface ChatMessage {
  role: string; content: string; cls: string; ts?: string
  /** Original unprocessed text — source of truth for reparse on stream completion. */
  rawText?: string
  /** Structured metadata for role-specific data (e.g. tool_input for permission messages). */
  meta?: Record<string, unknown>
}

/** Parsed content block produced by the block assembler. */
export type BlockType = 'markdown' | 'code' | 'diff' | 'mermaid'
export interface ContentBlock {
  type: BlockType
  content: string
  language?: string
  complete: boolean
}

export interface Notification {
  kind: string; title: string; body: string; ts: string
  acked?: boolean; job_id?: string; task_id?: string; slot?: string
}

export interface SubagentInfo {
  id: string; task: string; done: boolean; error?: string; result?: string
}

export interface SessionInfo {
  key: string; title: string; messages: number
  tool_calls?: number; created?: string; project?: string
}

export interface TaskStepDetail {
  index: number; title: string; description: string; status: string; error: string; result: string; attempts: number
  depends_on: number[]; requires_approval: boolean
}
export interface TaskRunRun {
  task_id: string; name?: string; running: boolean; status: string
  steps: number; completed: number; failed: number; skipped: number
  current_step: number; spec: string; spec_name: string; error: string
  tokens_used: number; replan_count: number; acceptance_rounds: number; step_details: TaskStepDetail[]
  started_at: number; finished_at: number
  work_dir: string; branch_name: string
  spec_content: string; lessons_learned: string[]; commits: number
  original_input: string; source: string; groups: number[][]
}
export interface TaskRunnerStatus {
  running: boolean; available: boolean; runs: TaskRunRun[]
}
