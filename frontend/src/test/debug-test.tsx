import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import DiffView from '../components/DiffView'

describe('debug', () => {
  it('check lines', () => {
    const { container } = render(
      <DiffView oldContent={"a\nb"} newContent={"a\nc"} oldLabel="v1" newLabel="v2" onClose={() => {}} />
    )
    const allLines = container.querySelectorAll('[data-diff-line]')
    throw new Error('LINES=' + allLines.length + ' HTML=' + container.innerHTML.substring(0, 800))
  })
})
