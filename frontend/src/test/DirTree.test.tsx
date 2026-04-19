import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { render } from '@testing-library/react'
import DirTree from '../components/DirTree'

vi.mock('../api/client', () => ({
  api: {
    browse: vi.fn(),
  },
}))

import { api } from '../api/client'

const workspaces = [
  { name: 'project-a', path: '/home/user/project-a' },
  { name: 'project-b', path: '/home/user/project-b' },
]

describe('DirTree', () => {
  beforeEach(() => {
    vi.mocked(api.browse).mockResolvedValue({
      path: '/home/user',
      parent: '/home',
      entries: [
        { name: 'project-a', path: '/home/user/project-a', isDir: true },
        { name: 'project-b', path: '/home/user/project-b', isDir: true },
        { name: 'Documents', path: '/home/user/Documents', isDir: true },
      ],
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders closed state showing current value', () => {
    render(<DirTree value="/home/user/project-a" onChange={vi.fn()} workspaces={workspaces} />)
    expect(screen.getByText(/project-a/)).toBeInTheDocument()
  })

  it('renders default path placeholder when value is empty', () => {
    render(<DirTree value="" onChange={vi.fn()} workspaces={workspaces} />)
    expect(screen.getByText('~ (default)')).toBeInTheDocument()
  })

  it('opens directory browser on click', async () => {
    render(<DirTree value="/home/user" onChange={vi.fn()} workspaces={workspaces} />)

    // Click to open
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      // Should show workspace bookmarks
      expect(screen.getByText('project-a')).toBeInTheDocument()
      expect(screen.getByText('project-b')).toBeInTheDocument()
    })
  })

  it('shows "Use this" button when open', async () => {
    render(<DirTree value="/home/user" onChange={vi.fn()} workspaces={workspaces} />)

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByText('Use this')).toBeInTheDocument()
    })
  })

  it('calls onChange when selecting a workspace bookmark', async () => {
    const onChange = vi.fn()
    render(<DirTree value="/home/user" onChange={onChange} workspaces={workspaces} />)

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByText('project-a')).toBeInTheDocument()
    })

    // Click a workspace bookmark
    fireEvent.click(screen.getAllByText('project-a')[0])
    expect(onChange).toHaveBeenCalledWith('/home/user/project-a')
  })

  it('calls onChange when clicking "Use this" for current directory', async () => {
    const onChange = vi.fn()
    render(<DirTree value="/home/user" onChange={onChange} workspaces={workspaces} />)

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByText('Use this')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Use this'))
    expect(onChange).toHaveBeenCalledWith('/home/user')
  })

  it('shows close button when open', async () => {
    render(<DirTree value="/home/user" onChange={vi.fn()} workspaces={workspaces} />)

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByText('✕')).toBeInTheDocument()
    })
  })

  it('shows loading state', async () => {
    vi.mocked(api.browse).mockReturnValue(new Promise(() => {}))

    render(<DirTree value="" onChange={vi.fn()} workspaces={workspaces} />)

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows empty directory message', async () => {
    vi.mocked(api.browse).mockResolvedValue({
      path: '/home/user/empty',
      parent: '/home/user',
      entries: [],
    })

    render(<DirTree value="" onChange={vi.fn()} workspaces={workspaces} />)

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByText('Empty directory')).toBeInTheDocument()
    })
  })
})
