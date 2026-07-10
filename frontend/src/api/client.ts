import { authHeader } from './auth'

export const j = async (r: Response) => {
  if (!r.ok) {
    const errText = await r.text()
    throw new Error(errText || `HTTP ${r.status}`)
  }
  return r.json()
}
function optionalHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  const merged = { ...(headers || {}), ...authHeader() }
  return Object.keys(merged).length > 0 ? merged : undefined
}

const post = (url: string, body?: object) =>
  fetch(url, { method: 'POST', headers: optionalHeaders({ 'Content-Type': 'application/json' }), body: body ? JSON.stringify(body) : undefined })
const put = (url: string, body: object) =>
  fetch(url, { method: 'PUT', headers: optionalHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) })
const del = (url: string, body?: object) =>
  fetch(url, { method: 'DELETE', headers: optionalHeaders(body ? { 'Content-Type': 'application/json' } : undefined), body: body ? JSON.stringify(body) : undefined })
const get = (url: string) => {
  const headers = optionalHeaders()
  return headers ? fetch(url, { headers }) : fetch(url)
}
/** Authenticated fetch — injects auth header into any fetch call. */
const afetch = (url: string, opts?: RequestInit) => {
  const headers = optionalHeaders(opts?.headers as Record<string, string> | undefined)
  if (headers) return fetch(url, { ...opts, headers })
  return opts ? fetch(url, opts) : fetch(url)
}

export const api = {
  status: () => get('/api/status').then(j),
  system: () => get('/api/system').then(j),
  // Memory
  memoryPreferences: () => get('/api/memory/preferences').then(j),
  saveMemoryPreferences: (content: string) => put('/api/memory/preferences', { content }),
  memoryProjects: () => get('/api/memory/projects').then(j),
  saveMemoryProjects: (content: string) => put('/api/memory/projects', { content }),
  memoryHistory: () => get('/api/memory/history').then(j),
  saveMemoryHistory: (content: string) => put('/api/memory/history', { content }),
  memorySettings: () => get('/api/memory/settings').then(j),
  saveMemorySettings: (s: {history_idle_hours?: number; history_max_days?: number}) => put('/api/memory/settings', s),
  // Vector memory
  vectorSemantic: () => get('/api/memory/semantic').then(j),
  vectorSemanticWrite: (key: string, value: string) => put('/api/memory/semantic', { key, value, source: 'user_explicit' }).then(j),
  vectorSemanticDelete: (key: string) => del('/api/memory/semantic/' + encodeURIComponent(key)),
  vectorEpisodic: (limit = 50, offset = 0, tags?: string) => get('/api/memory/episodic?limit=' + limit + '&offset=' + offset + (tags ? '&tags=' + encodeURIComponent(tags) : '')).then(j),
  vectorEpisodicSearch: (q: string, tags?: string) => afetch('/api/memory/episodic/search?q=' + encodeURIComponent(q) + (tags ? '&tags=' + encodeURIComponent(tags) : '')).then(j),
  vectorEpisodicDelete: (id: string) => del('/api/memory/episodic/' + encodeURIComponent(id)),
  vectorStats: () => get('/api/memory/stats').then(j),
  vectorEvents: (limit = 50, offset = 0) => afetch('/api/memory/events?limit=' + limit + '&offset=' + offset).then(j),
  vectorEmbeddingStatus: () => get('/api/memory/embedding-status').then(j),
  vectorEnableEmbeddings: () => post('/api/memory/enable-embeddings').then(j),
  vectorDisableEmbeddings: () => post('/api/memory/disable-embeddings').then(j),
  vectorMigrate: () => post('/api/memory/migrate').then(j),
  vectorImport: (data: object) => post('/api/memory/import', data).then(j),
  vectorContextPreview: (query?: string) => afetch('/api/memory/context-preview' + (query ? '?q=' + encodeURIComponent(query) : '')).then(j),
  consolidateMemory: (key: string, includeHistory: boolean) => post('/api/memory/consolidate', { key, include_history: includeHistory }).then(j),
  restartSessions: () => post('/api/sessions/restart').then(j),
  sessionsContext: () => get('/api/sessions/context').then(j),
  sessionsUsage: () => get('/api/sessions/usage').then(j),
  // AIM integration
  aimMcpList: () => get('/api/aim/mcp').then(j),
  mcpProbeCache: () => get('/api/mcp/probe').then(j),
  aimMcpInstall: (serverId: string) => post('/api/aim/mcp/install', { server_id: serverId }).then(j),
  aimMcpUninstall: (serverId: string) => post('/api/aim/mcp/uninstall', { server_id: serverId }).then(j),
  aimSkillsList: () => get('/api/aim/skills').then(j),
  aimSkillsInstall: (pkg: string, vs?: string) => post('/api/aim/skills/install', { package: pkg, version_set: vs || '' }).then(j),
  aimSkillsUninstall: (pkg: string) => post('/api/aim/skills/uninstall', { package: pkg }).then(j),
  // Agents
  agentsInstalled: () => get('/api/agents/installed').then(j),
  agentDetail: (name: string) => afetch('/api/agents/detail/' + encodeURIComponent(name)).then(j),
  agentDelete: (name: string) => afetch('/api/agents/detail/' + encodeURIComponent(name), { method: 'DELETE' }).then(j),
  // AIM
  aimAgentsList: () => get('/api/aim/agents').then(j),
  aimAgentsInstall: (pkg: string, vs?: string) => post('/api/aim/agents/install', { package: pkg, version_set: vs || '' }).then(j),
  aimAgentsUninstall: (pkg: string) => post('/api/aim/agents/uninstall', { package: pkg }).then(j),
  aimUpdate: (kind: string, pkg?: string) => post('/api/aim/update', { kind, package: pkg || '' }).then(j),
  aimMcpRegistry: () => get('/api/aim/mcp/registry').then(j),
  chatSlotAgent: (slot: string, agent: string) =>
    post('/api/chat/slots/' + encodeURIComponent(slot) + '/agent', { agent }).then(j),
  chatSlotWorkspace: (slot: string, workspace: string) =>
    post('/api/chat/slots/' + encodeURIComponent(slot) + '/workspace', { workspace }).then(j),
  workspaces: () => get('/api/workspaces').then(j),
  browse: (path?: string) => afetch('/api/browse' + (path ? '?path=' + encodeURIComponent(path) : '')).then(j) as Promise<{ path: string; parent: string; entries: { name: string; path: string; isDir: boolean }[] }>,
  pathComplete: (input: string) => afetch('/api/path-complete?input=' + encodeURIComponent(input)).then(j) as Promise<{ dir: string; prefix: string; entries: { name: string; path: string; isDir: boolean }[] }>,
  models: () => get('/api/models').then(j),
  setSlotModel: (slot: string, provider: string, modelId: string) =>
    post('/api/chat/slots/' + encodeURIComponent(slot) + '/model', { provider, modelId }).then(j),
  setSlotCwd: (slot: string, cwd: string) =>
    post('/api/chat/slots/' + encodeURIComponent(slot) + '/cwd', { cwd }).then(j),
  slotSystemPrompt: (slot: string) =>
    afetch('/api/chat/slots/' + encodeURIComponent(slot) + '/system-prompt').then(j) as Promise<{ static: string; runtime: string; memory: string; memoryStats: { semantic: number; lessons: number } }>,
  setSlotThinking: (slot: string, level: string) =>
    post('/api/chat/slots/' + encodeURIComponent(slot) + '/thinking', { level }).then(j),
  // Crons (OS crontab, read-only legacy surface)
  crons: () => get('/api/crons').then(j),
  createCron: (body: object) => post('/api/crons', body).then(j),
  deleteCron: (id: string) => del('/api/crons/' + id).then(j),
  toggleCron: (id: string, enabled: boolean) => post('/api/crons/' + id + '/enable', { enabled }).then(j),
  ackCron: (id: string, summary: string, ts?: string) => post('/api/crons/' + id + '/ack', { summary, ts }).then(j),
  // Scheduled pi jobs
  jobs: () => get('/api/jobs').then(j),
  createJob: (body: object) => post('/api/jobs', body).then(j),
  updateJob: (id: string, body: object) => fetch('/api/jobs/' + encodeURIComponent(id), { method: 'PATCH', headers: optionalHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) }).then(j),
  deleteJob: (id: string) => del('/api/jobs/' + encodeURIComponent(id)).then(j),
  runJob: (id: string) => post('/api/jobs/' + encodeURIComponent(id) + '/run').then(j),
  // Lessons
  lessons: () => get('/api/lessons').then(j),
  createLesson: (rule: string, category: string) => post('/api/lessons', { rule, category }).then(j),
  deleteLesson: (rule: string) => del('/api/lessons', { rule }).then(j),
  // Hooks
  hooks: () => get('/api/hooks').then(j),
  createHook: (body: object) => post('/api/hooks', body).then(j),
  updateHook: (id: string, body: object) => put('/api/hooks/' + id, body).then(j),
  deleteHook: (id: string) => del('/api/hooks/' + id).then(j),
  toggleHook: (id: string) => post('/api/hooks/' + id + '/toggle', {}).then(j),
  testHook: (id: string, context?: string) => post('/api/hooks/' + id + '/test', { context: context || 'test' }).then(j),
  // Skills
  skills: () => get('/api/skills').then(j),
  skill: (name: string) => afetch('/api/skills/' + name.split('/').map(encodeURIComponent).join('/')).then(j),
  createSkill: (name: string, content: string) => post('/api/skills', { name, content }).then(j),
  updateSkill: (name: string, content: string) => put('/api/skills/' + name.split('/').map(encodeURIComponent).join('/'), { content }).then(j),
  deleteSkill: (name: string) => del('/api/skills/' + name.split('/').map(encodeURIComponent).join('/')).then(j),
  // MCP
  mcpServers: () => get('/api/mcp').then(j),
  mcpActive: (agent?: string) => afetch('/api/mcp/active' + (agent ? `?agent=${encodeURIComponent(agent)}` : '')).then(j),
  mcpProbe: () => post('/api/mcp/probe').then(j),
  mcpSync: () => post('/api/mcp/sync').then(j),
  mcpToggle: (name: string, enabled: boolean) => post('/api/mcp/toggle', { name, enabled }).then(j),
  mcpToggleTool: (server: string, tool: string, enabled: boolean) => post('/api/mcp/toggle-tool', { server, tool, enabled }).then(j),
  mcpToggleAll: (enabled: boolean) => post('/api/mcp/toggle-all', { enabled }).then(j),
  mcpRemove: (name: string) => post('/api/mcp/remove', { name }).then(j),
  // Agent config
  agentConfig: () => get('/api/agent/config').then(j),
  saveAgentConfig: (config: object) => put('/api/agent/config', { config }).then(j),
  defaultAgent: () => get('/api/config/default-agent').then(j),
  setDefaultAgent: (agent: string) => put('/api/config/default-agent', { agent }).then(j),
  // Chat
  chatSlots: () => get('/api/chat/slots').then(j),
  chatSlotDetail: (slot: string, limit?: number, before?: number) => {
    const p = new URLSearchParams()
    if (limit) p.set('limit', String(limit))
    if (before !== undefined) p.set('before', String(before))
    return afetch('/api/chat/slots/' + encodeURIComponent(slot) + '?' + p).then(j)
  },
  createChatSlot: (name?: string, agent?: string, model?: string, cwd?: string) => post('/api/chat/slots', { ...(name ? { name } : {}), ...(agent ? { agent } : {}), ...(model ? { model } : {}), ...(cwd ? { cwd } : {}) }).then(j),
  deleteChatSlot: (slot: string) => del('/api/chat/slots/' + encodeURIComponent(slot)).then(j),
  stopChatSlot: (slot: string) => post('/api/chat/slots/' + encodeURIComponent(slot) + '/stop').then(j),
  conductorDetach: (slot: string) => post('/api/chat/slots/' + encodeURIComponent(slot) + '/conductor-detach').then(j),
  extensionUiResponse: (slot: string, body: { id: string; cancelled?: boolean; value?: string | boolean }) => post('/api/chat/slots/' + encodeURIComponent(slot) + '/extension-ui-response', body).then(j),
  approveChatSlot: (slot: string, action: string) => post('/api/chat/slots/' + encodeURIComponent(slot) + '/approve', { action }).then(j),
  resumeChatSlot: (key: string, title?: string, file?: string) => post('/api/chat/slots/' + encodeURIComponent(key) + '/resume', { name: key, key, title: title || key, file }).then(j),
  chatMode: (mode: string, slot?: string) => post('/api/chat/mode', { mode, slot: slot || '' }).then(j),
  generateTitle: (slot: string) => post('/api/chat/slots/' + encodeURIComponent(slot) + '/generate-title').then(j),
  renameSlot: (slot: string, title: string) => afetch('/api/chat/slots/' + encodeURIComponent(slot) + '/title', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) }).then(j),
  tagSlot: (slot: string, tags: string[]) => afetch('/api/chat/slots/' + encodeURIComponent(slot) + '/tags', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags }) }).then(j),
  sendChat: (message: string, slot?: string) =>
    afetch('/api/chat?ws=1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, slot }) }),
  // Notifications
  notifications: () => get('/api/notifications').then(j),
  deleteNotification: (ts: string) => del('/api/notifications', { ts }).then(j),
  clearNotifications: () => post('/api/notifications/clear').then(j),
  ackNotification: (ts: string) => post('/api/notifications/ack', { ts }).then(j),
  unackNotification: (ts: string) => post('/api/notifications/unack', { ts }).then(j),
  ackAllNotifications: () => post('/api/notifications/ack-all').then(j),
  // Sessions (history)
  sessions: (limit = 30, offset = 0) => afetch('/api/sessions?limit=' + limit + '&offset=' + offset).then(j),
  searchSessions: (query: string, limit = 20) => afetch('/api/sessions/search?q=' + encodeURIComponent(query) + '&limit=' + limit).then(j),
  sessionDetail: (key: string) => afetch('/api/sessions/' + encodeURIComponent(key)).then(j),
  deleteSession: (key: string) => del('/api/sessions/' + encodeURIComponent(key)).then(j),
  clearSessions: () => del('/api/sessions').then(j),
  // Spawn
  spawnList: () => get('/api/spawn').then(j),
  spawn: (task: string) => post('/api/spawn', { task }).then(j),
  spawnStatus: (id: string) => afetch('/api/spawn/' + encodeURIComponent(id)).then(j),
  spawnDelete: (id: string) => del('/api/spawn/' + encodeURIComponent(id)).then(j),
  spawnClear: () => del('/api/spawn').then(j),
  approvals: () => get('/api/approvals').then(j),
  resolveApproval: (id: string, action: 'approve' | 'reject') => post('/api/approvals/' + encodeURIComponent(id) + '/' + action, {}).then(j),
  // Logs
  logLevel: () => get('/api/logs/level').then(j),
  setLogLevel: (level: string) => post('/api/logs/level', { level }).then(j),
  // Task runner
  taskRunnerStatus: () => get('/api/taskrunner').then(j),
  startTaskRunner: (spec: string, agent?: string) => post('/api/taskrunner', { spec, agent: agent || '' }).then(j),
  cancelTaskRunner: (taskId?: string) => post('/api/taskrunner/cancel', taskId ? { task_id: taskId } : undefined).then(j),
  deleteTaskRun: (taskId: string) => del('/api/taskrunner/' + encodeURIComponent(taskId)).then(j),
  retryTaskRun: (taskId: string, fromStep: number) => post('/api/taskrunner/' + encodeURIComponent(taskId) + '/retry', { from_step: fromStep }).then(j),
  taskRunToChat: (taskId: string) => post('/api/taskrunner/' + encodeURIComponent(taskId) + '/to-chat').then(j),
  revealPath: (path: string) => post('/api/reveal', { path }).then(j).then((r: any) => {
    if (r.copy) navigator.clipboard.writeText(r.copy)
    return r
  }),
  refineTaskInput: (input: string) => post('/api/taskrunner/refine', { input }).then(j),
  refineStatus: () => get('/api/taskrunner/refine').then(j),
  refineCancel: () => post('/api/taskrunner/refine/cancel').then(j),
  refineAnswer: (answer: string) => post('/api/taskrunner/refine/answer', { answer }).then(j),
  planTask: (input: string, source: string, spec?: string, agent?: string) =>
    post('/api/taskrunner/plan', { input, source, spec: spec || '', agent: agent || '' }).then(j),
  cancelPlan: () => post('/api/taskrunner/plan/cancel').then(j),
  updatePlan: (taskId: string, steps: any[]) =>
    put('/api/taskrunner/' + encodeURIComponent(taskId) + '/plan', { steps }).then(j),
  executePlan: (taskId: string, agent?: string) =>
    post('/api/taskrunner/' + encodeURIComponent(taskId) + '/execute', { agent: agent || '' }).then(j),
  planFromChat: (steps: any[], taskId?: string, originalInput?: string) =>
    post('/api/taskrunner/from-chat', { steps, task_id: taskId || '', original_input: originalInput || '' }).then(j),
  planContext: (taskId: string) =>
    afetch('/api/taskrunner/' + encodeURIComponent(taskId) + '/plan-context').then(j),
  // Update
  checkUpdate: () => get('/api/update/check').then(j),
  changelog: () => get('/api/changelog').then(j),
  applyUpdate: () => post('/api/update').then(j),
  setAutoUpdate: (enabled: boolean) => post('/api/update/auto', { enabled }).then(j),
  pickFiles: () => post('/api/upload').then(j) as Promise<{ paths: string[] }>,
  uploadFiles: (files: { name: string; data: string }[]) => post('/api/upload-files', { files }).then(j) as Promise<{ ok: boolean; paths: string[] }>,
  saveImage: (data: string, mimeType: string, path: string) => post('/api/save-image', { data, mimeType, path }).then(j) as Promise<{ ok: boolean; path: string }>,
  screenshot: () => post('/api/screenshot').then(j) as Promise<{ path: string }>,
  // Graph
  graphStats: () => get('/api/graph/stats').then(j),
  graphSearch: (q: string, type?: string, limit = 20) =>
    afetch('/api/graph/search?q=' + encodeURIComponent(q) + (type ? '&type=' + type : '') + '&limit=' + limit).then(j),
  graphEntity: (id: string) => afetch('/api/graph/entity/' + encodeURIComponent(id)).then(j),
  graphNeighbors: (id: string, depth = 1, limit = 50) =>
    afetch('/api/graph/neighbors?id=' + encodeURIComponent(id) + '&depth=' + depth + '&limit=' + limit).then(j),
  graphPath: (from: string, to: string, maxDepth = 4) =>
    afetch('/api/graph/path?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) + '&maxDepth=' + maxDepth).then(j),
  graphTop: (type?: string, limit = 20) =>
    afetch('/api/graph/top?' + (type ? 'type=' + type + '&' : '') + 'limit=' + limit).then(j),
  // Session diff
  slotDiff: (slot: string, paths: string[]) =>
    post('/api/chat/slots/' + encodeURIComponent(slot) + '/diff', { paths }).then(j) as Promise<{ files: { path: string; gitDiff?: string }[]; isGitRepo: boolean }>,
}
