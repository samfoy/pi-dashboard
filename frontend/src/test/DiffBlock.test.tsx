import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DiffBlock from '../components/DiffBlock'

const simpleDiff = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 const a = 1
-const b = 2
+const b = 3
+const c = 4
 const d = 5`

describe('DiffBlock', () => {
  it('renders diff header', () => {
    render(<DiffBlock code={simpleDiff} complete={true} />)
    expect(screen.getByText('diff')).toBeInTheDocument()
  })

  it('shows added lines with + prefix', () => {
    const { container } = render(<DiffBlock code={simpleDiff} complete={true} />)
    const addLines = container.querySelectorAll('.bg-diff-add')
    expect(addLines.length).toBeGreaterThan(0)
  })

  it('shows deleted lines with - prefix', () => {
    const { container } = render(<DiffBlock code={simpleDiff} complete={true} />)
    const delLines = container.querySelectorAll('.bg-diff-del')
    expect(delLines.length).toBeGreaterThan(0)
  })

  it('shows generating indicator when not complete', () => {
    render(<DiffBlock code={simpleDiff} complete={false} />)
    expect(screen.getByText('generating diff…')).toBeInTheDocument()
  })

  it('hides generating indicator when complete', () => {
    render(<DiffBlock code={simpleDiff} complete={true} />)
    expect(screen.queryByText('generating diff…')).not.toBeInTheDocument()
  })

  it('has copy button on hover', () => {
    render(<DiffBlock code={simpleDiff} complete={true} />)
    expect(screen.getByText('Copy patch')).toBeInTheDocument()
  })

  it('toggles between unified and split view', () => {
    render(<DiffBlock code={simpleDiff} complete={true} />)
    const toggle = screen.getByText('split')
    fireEvent.click(toggle)
    expect(screen.getByText('unified')).toBeInTheDocument()
  })

  it('handles kiro-cli diff format', () => {
    const kiroDiff = `+10:const x = 1\n-5:const y = 2`
    const { container } = render(<DiffBlock code={kiroDiff} complete={true} />)
    expect(container.querySelectorAll('.bg-diff-add').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.bg-diff-del').length).toBeGreaterThan(0)
  })
})
