import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, waitFor, act } from '@testing-library/react'
import { renderWithProviders, createTestStore } from './helpers'
import SystemPage from '../pages/SystemPage'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../api/client', () => ({
  api: { system: vi.fn() },
  j: (x: any) => x,
}))

vi.mock('../hooks/useUptime', () => ({
  useUptime: () => '1h 23m',
}))

vi.mock('../components/ui', () => ({
  PageHeader: ({ title }: { title: string }) => (
    <div data-testid="page-header">{title}</div>
  ),
  StatCard: ({ label, value }: { label: string; value: any }) => (
    <div data-testid="stat-card" data-label={label}>{String(value)}</div>
  ),
}))

vi.mock('../components/MarkdownRenderer', () => ({
  default: ({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content}</div>
  ),
}))

// ── Fixture data ──────────────────────────────────────────────────────────────

const SYSTEM_DATA = {
  hostname: 'pi-host', os: 'Linux', arch: 'arm64', cpu_count: 4,
  load_1m: 0.5, load_5m: 0.4, load_15m: 0.3,
  mem_used_gb: 2.1, mem_total_gb: 8.0,
  disk_free_gb: 10.0, disk_total_gb: 32.0,
  ip: '192.168.1.1', pid: 1234, proc_mem_mb: 128,
}

const SKILLS_DATA = [
  { name: 'skill-one', description: 'First skill' },
  { name: 'skill-two', description: 'Second skill' },
]

const EXTENSIONS_DATA = [
  { name: 'ext-one', file: 'ext1.js', description: 'First extension' },
]

const CRONTAB_DATA = [
  { schedule: '0 * * * *', command: '/usr/bin/python3 /scripts/backup.py' },
]

const VAULT_DATA = {
  path: '/Users/sam/Vault',
  dailyNotes: 100, taskNotes: 50, meetingNotes: 20,
  persons: 10, recipes: 5, recentDaily: '2026-01-15',
}

const MEMORY_DATA = {
  stats: { facts: 42, lessons: 17, events: 8, episodic: 3 },
  facts: [{ key: 'user.name', value: 'Sam' }],
  lessons: [
    { rule: 'Use TypeScript', negative: false, category: 'coding', created_at: '2026-01-01' },
  ],
}

const SESSIONS_DATA = {
  sessions: [
    { title: 'Session Alpha', project: 'proj-x', size: 4096, modified: '2026-04-19T12:00:00Z' },
  ],
}

const DAILY_NOTES_DATA = [
  { date: '2026-04-19', size: 2048 },
  { date: '2026-04-18', size: 1024 },
]

const HOST_SESSIONS_DATA = {
  sessions: [
    {
      windowName: 'my-pi', tmuxSession: 'main', cwd: '/home/sam',
      pid: 999, size: '200x50', attachCmd: 'tmux attach -t main',
    },
  ],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFetchMock(overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = {
    '/api/skills': SKILLS_DATA,
    '/api/pi/extensions': EXTENSIONS_DATA,
    '/api/pi/crontab': CRONTAB_DATA,
    '/api/pi/vault': VAULT_DATA,
    '/api/pi/memory': MEMORY_DATA,
    '/api/sessions?limit=20': SESSIONS_DATA,
    '/api/pi/vault/daily?limit=10': DAILY_NOTES_DATA,
    '/api/host-sessions': HOST_SESSIONS_DATA,
    ...overrides,
  }
  return vi.fn((url: string) => {
    if (url in defaults) return Promise.resolve(defaults[url])
    // date-specific daily note fetch: /api/pi/vault/daily/<date>
    if (url.startsWith('/api/pi/vault/daily/')) {
      const date = url.split('/').pop()
      return Promise.resolve({ content: `# Daily note for ${date}` })
    }
    return Promise.resolve(null)
  })
}

const STATUS = { sessions: 5, messages: 200, tool_calls: 30, uptime: '1h', cron_jobs: 0, subagents: 0, lessons: 0 }

async function renderPage(fetchOverrides: Record<string, any> = {}) {
  const fetchMock = makeFetchMock(fetchOverrides)
  global.fetch = fetchMock as any
  const store = createTestStore({ dashboard: { status: STATUS, connected: true, slots: [], approvalMode: 'normal', refreshTrigger: 0, unreadSlots: [] } })
  let result!: ReturnType<typeof renderWithProviders>
  await act(async () => {
    result = renderWithProviders(<SystemPage />, { store })
  })
  return { ...result, fetchMock }
}

function statCard(label: string) {
  return screen.getAllByTestId('stat-card').find(c => (c as HTMLElement).dataset.label === label)
}

// ── Setup/teardown ────────────────────────────────────────────────────────────

beforeEach(async () => {
  const { api } = await import('../api/client')
  vi.mocked(api.system).mockResolvedValue(SYSTEM_DATA as any)
})

afterEach(() => {
  vi.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SystemPage — initial render', () => {
  it('renders the page header with title "System"', async () => {
    await renderPage()
    expect(screen.getByTestId('page-header')).toHaveTextContent('System')
  })

  it('renders all 6 tab buttons', async () => {
    await renderPage()
    for (const label of ['Overview', 'Host Sessions', 'Memory', 'Skills', 'Sessions', 'Vault']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('overview tab content is visible by default', async () => {
    await renderPage()
    // The Host card title is present only in the overview tab
    expect(screen.getByText('🖥 Host')).toBeInTheDocument()
  })
})

describe('SystemPage — StatCards on mount', () => {
  it('Sessions stat card shows status.sessions value', async () => {
    await renderPage()
    const card = statCard('Sessions')
    expect(card).toBeDefined()
    expect(card!.textContent).toBe('5')
  })

  it('Skills stat card reflects loaded skills count', async () => {
    await renderPage()
    const card = statCard('Skills')
    expect(card).toBeDefined()
    expect(card!.textContent).toBe('2')
  })

  it('Lessons stat card reflects memory.stats.lessons', async () => {
    await renderPage()
    const card = statCard('Lessons')
    expect(card).toBeDefined()
    expect(card!.textContent).toBe('17')
  })

  it('Facts stat card reflects memory.stats.facts', async () => {
    await renderPage()
    const card = statCard('Facts')
    expect(card).toBeDefined()
    expect(card!.textContent).toBe('42')
  })
})

describe('SystemPage — api.system() on mount', () => {
  it('calls api.system() once on mount', async () => {
    const { api } = await import('../api/client')
    await renderPage()
    expect(api.system).toHaveBeenCalledTimes(1)
  })

  it('renders hostname from system data in overview', async () => {
    await renderPage()
    expect(screen.getByText('pi-host')).toBeInTheDocument()
  })

  it('shows uptime from useUptime hook', async () => {
    await renderPage()
    // useUptime is mocked to return '1h 23m'
    expect(screen.getByText('1h 23m')).toBeInTheDocument()
  })
})

describe('SystemPage — static fetch calls on mount', () => {
  it('fetches /api/skills on mount', async () => {
    const { fetchMock } = await renderPage()
    expect(fetchMock).toHaveBeenCalledWith('/api/skills')
  })

  it('fetches /api/pi/extensions on mount', async () => {
    const { fetchMock } = await renderPage()
    expect(fetchMock).toHaveBeenCalledWith('/api/pi/extensions')
  })

  it('fetches /api/pi/crontab on mount', async () => {
    const { fetchMock } = await renderPage()
    expect(fetchMock).toHaveBeenCalledWith('/api/pi/crontab')
  })

  it('fetches /api/pi/vault on mount', async () => {
    const { fetchMock } = await renderPage()
    expect(fetchMock).toHaveBeenCalledWith('/api/pi/vault')
  })

  it('fetches /api/pi/memory on mount', async () => {
    const { fetchMock } = await renderPage()
    expect(fetchMock).toHaveBeenCalledWith('/api/pi/memory')
  })
})

describe('SystemPage — tab switching', () => {
  it('clicking Memory tab shows memory content', async () => {
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Memory' }))
    expect(screen.getByText('📝 Lessons')).toBeInTheDocument()
  })

  it('clicking Skills tab shows skills content', async () => {
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }))
    expect(screen.getByText(/Skills \(\d+\)/)).toBeInTheDocument()
  })

  it('clicking Sessions tab shows recent sessions content', async () => {
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }))
    expect(screen.getByText(/Recent Sessions/)).toBeInTheDocument()
  })

  it('clicking Vault tab shows daily notes panel when vault is configured', async () => {
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Vault' }))
    expect(screen.getByText('📅 Daily Notes')).toBeInTheDocument()
  })

  it('switching away from overview hides overview-only content', async () => {
    await renderPage()
    expect(screen.getByText('🖥 Host')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Memory' }))
    expect(screen.queryByText('🖥 Host')).not.toBeInTheDocument()
  })
})

describe('SystemPage — Host Sessions tab', () => {
  it('clicking Host Sessions tab shows sessions from initial fetch', async () => {
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Host Sessions' }))
    })
    expect(screen.getByText('my-pi')).toBeInTheDocument()
  })

  it('clicking Refresh button re-fetches /api/host-sessions', async () => {
    const { fetchMock } = await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Host Sessions' }))
    const countBefore = fetchMock.mock.calls.filter(([url]: [string]) => url === '/api/host-sessions').length
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Refresh/ }))
    })
    const countAfter = fetchMock.mock.calls.filter(([url]: [string]) => url === '/api/host-sessions').length
    expect(countAfter).toBeGreaterThan(countBefore)
  })

  it('shows empty-state card when no host sessions exist', async () => {
    await renderPage({ '/api/host-sessions': { sessions: [] } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Host Sessions' }))
    })
    expect(screen.getByText(/No pi sessions found/)).toBeInTheDocument()
  })
})

describe('SystemPage — Vault not configured', () => {
  it('shows "Not configured" message in overview when vault path is empty', async () => {
    await renderPage({
      '/api/pi/vault': { path: '', dailyNotes: 0, taskNotes: 0, meetingNotes: 0, persons: 0, recipes: 0, recentDaily: '' },
    })
    expect(screen.getByText(/Not configured/i)).toBeInTheDocument()
  })

  it('shows "Not configured" card in vault tab when vault path is empty', async () => {
    await renderPage({
      '/api/pi/vault': { path: '', dailyNotes: 0, taskNotes: 0, meetingNotes: 0, persons: 0, recipes: 0, recentDaily: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Vault' }))
    expect(screen.getByText(/Vault path not configured/i)).toBeInTheDocument()
  })
})

describe('SystemPage — Vault configured', () => {
  it('vault tab shows daily notes list with dates', async () => {
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Vault' }))
    expect(screen.getByText('2026-04-19')).toBeInTheDocument()
    expect(screen.getByText('2026-04-18')).toBeInTheDocument()
  })

  it('vault overview card shows vault path', async () => {
    await renderPage()
    expect(screen.getByText('/Users/sam/Vault')).toBeInTheDocument()
  })
})

describe('SystemPage — loadDaily', () => {
  it('fetches the correct URL when a daily note date is clicked', async () => {
    const { fetchMock } = await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Vault' }))
    await act(async () => {
      fireEvent.click(screen.getByText('2026-04-19'))
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/pi/vault/daily/2026-04-19')
  })

  it('renders the fetched daily note content via MarkdownRenderer', async () => {
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Vault' }))
    await act(async () => {
      fireEvent.click(screen.getByText('2026-04-19'))
    })
    await waitFor(() => {
      expect(screen.getByTestId('markdown-renderer')).toHaveTextContent('Daily note for 2026-04-19')
    })
  })
})

describe('SystemPage — Cron jobs', () => {
  it('shows "No cron jobs" when crontab is empty', async () => {
    await renderPage({ '/api/pi/crontab': [] })
    expect(screen.getByText(/No cron jobs/i)).toBeInTheDocument()
  })

  it('renders crontab schedule', async () => {
    await renderPage()
    expect(screen.getByText('0 * * * *')).toBeInTheDocument()
  })

  it('renders crontab command as last path segment', async () => {
    await renderPage()
    // The source does: c.command.split('/').pop() → 'backup.py'
    expect(screen.getByText('backup.py')).toBeInTheDocument()
  })
})
