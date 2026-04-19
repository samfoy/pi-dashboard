import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { render } from '@testing-library/react'
import FileBrowser from '../components/FileBrowser'

describe('FileBrowser', () => {
  const mockEntries = [
    { name: 'src', path: '/home/user/project/src', isDir: true },
    { name: 'README.md', path: '/home/user/project/README.md', isDir: false },
    { name: '.gitignore', path: '/home/user/project/.gitignore', isDir: false },
    { name: 'docs', path: '/home/user/project/docs', isDir: true },
  ]

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        path: '/home/user/project',
        parent: '/home/user',
        entries: mockEntries,
      }),
    } as Response)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders and loads entries on mount', async () => {
    render(<FileBrowser onFileOpen={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument()
    })
    expect(screen.getByText('README.md')).toBeInTheDocument()
    expect(screen.getByText('docs')).toBeInTheDocument()
  })

  it('shows filter input', async () => {
    render(<FileBrowser onFileOpen={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Filter...')).toBeInTheDocument()
    })
  })

  it('filters entries by name', async () => {
    render(<FileBrowser onFileOpen={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('Filter...'), { target: { value: 'README' } })

    expect(screen.getByText('README.md')).toBeInTheDocument()
    expect(screen.queryByText('src')).toBeNull()
    expect(screen.queryByText('docs')).toBeNull()
  })

  it('shows "No files" when filter matches nothing', async () => {
    render(<FileBrowser onFileOpen={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('Filter...'), { target: { value: 'zzzzz' } })

    expect(screen.getByText('No files')).toBeInTheDocument()
  })

  it('calls onFileOpen when clicking a file', async () => {
    const onFileOpen = vi.fn()
    render(<FileBrowser onFileOpen={onFileOpen} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('README.md'))
    expect(onFileOpen).toHaveBeenCalledWith('/home/user/project/README.md')
  })

  it('calls onClose when clicking close button', async () => {
    const onClose = vi.fn()
    render(<FileBrowser onFileOpen={vi.fn()} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('✕'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows loading state initially', () => {
    // Don't resolve fetch yet
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))

    render(<FileBrowser onFileOpen={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('expands a directory on click', async () => {
    const subEntries = [
      { name: 'index.ts', path: '/home/user/project/src/index.ts', isDir: false },
    ]

    let callCount = 0
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes(encodeURIComponent('/home/user/project/src'))) {
        return {
          ok: true,
          json: () => Promise.resolve({
            path: '/home/user/project/src',
            parent: '/home/user/project',
            entries: subEntries,
          }),
        } as Response
      }
      return {
        ok: true,
        json: () => Promise.resolve({
          path: '/home/user/project',
          parent: '/home/user',
          entries: mockEntries,
        }),
      } as Response
    })

    render(<FileBrowser onFileOpen={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('src'))

    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeInTheDocument()
    })
  })

  it('has hidden files toggle', async () => {
    render(<FileBrowser onFileOpen={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument()
    })

    // The .* button toggles hidden files
    expect(screen.getByText('.*')).toBeInTheDocument()
  })
})
