import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ImageRenderer from '../components/renderers/ImageRenderer'

// ── helpers ───────────────────────────────────────────────────────────────────

function renderImage(filePath = '/some/path/photo.png') {
  return render(<ImageRenderer filePath={filePath} />)
}

/** Returns the zoom-label <span> (shows 'Fit' or e.g. '125%') — not the 'Fit' button */
function zoomLabel() {
  const matches = screen.getAllByText(/^(Fit|\d+%)$/)
  return matches.find(el => el.tagName !== 'BUTTON')!
}

function zoomInBtn() {
  return screen.getByRole('button', { name: '+' })
}

function zoomOutBtn() {
  return screen.getByRole('button', { name: '−' })
}

function actualSizeBtn() {
  return screen.getByRole('button', { name: 'Actual Size' })
}

function fitBtn() {
  return screen.getByRole('button', { name: 'Fit' })
}

// ── URL & metadata ─────────────────────────────────────────────────────────────

describe('ImageRenderer — URL construction', () => {
  it('builds the src URL with encodeURIComponent', () => {
    renderImage('/path/to/my file.png')
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', '/api/local-file?path=%2Fpath%2Fto%2Fmy%20file.png')
  })

  it('handles paths with special chars (#, &, ?)', () => {
    renderImage('/files/a&b?c=1#d.png')
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toContain(encodeURIComponent('/files/a&b?c=1#d.png'))
  })

  it('uses the last path segment as img alt text', () => {
    renderImage('/deep/nested/photo.png')
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'photo.png')
  })

  it('uses full filePath as alt when path has no slashes', () => {
    renderImage('standalone.jpg')
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'standalone.jpg')
  })
})

// ── Initial state (fit mode) ───────────────────────────────────────────────────

describe('ImageRenderer — initial fit mode', () => {
  it('shows Fit label in initial state', () => {
    renderImage()
    expect(zoomLabel()).toHaveTextContent('Fit')
  })

  it('− button is NOT disabled in fit mode (scale=0, condition requires scale!==0)', () => {
    renderImage()
    expect(zoomOutBtn()).not.toBeDisabled()
  })

  it('+ button is not disabled in fit mode', () => {
    renderImage()
    expect(zoomInBtn()).not.toBeDisabled()
  })

  it('img has fit-mode style (maxWidth/maxHeight, no width override)', () => {
    renderImage()
    const img = screen.getByRole('img')
    expect(img).toHaveStyle({ maxWidth: '100%' })
  })
})

// ── Zoom in ────────────────────────────────────────────────────────────────────

describe('ImageRenderer — zoom in', () => {
  it('zoom + from fit mode uses 1.0 as base and shows 125%', () => {
    renderImage()
    fireEvent.click(zoomInBtn())
    expect(zoomLabel()).toHaveTextContent('125%')
  })

  it('subsequent zoom + increments by 0.25', () => {
    renderImage()
    fireEvent.click(zoomInBtn()) // 1.25
    fireEvent.click(zoomInBtn()) // 1.50
    expect(zoomLabel()).toHaveTextContent('150%')
  })

  it('img switches to width-based style after zooming', () => {
    renderImage()
    fireEvent.click(zoomInBtn())
    const img = screen.getByRole('img')
    expect(img).toHaveStyle({ width: '125%' })
  })

  it('+ button is disabled at max scale 5.0', () => {
    renderImage()
    // 1.0 + 16×0.25 = 5.0 (starting from fit, first click → 1.25, then +0.25 each time)
    // From fit: +1 → 1.25; need to reach 5.0 → 5.0-1.25 = 3.75 / 0.25 = 15 more clicks = 16 total
    for (let i = 0; i < 16; i++) fireEvent.click(zoomInBtn())
    expect(zoomLabel()).toHaveTextContent('500%')
    expect(zoomInBtn()).toBeDisabled()
  })

  it('+ clamps at 5.0 and does not exceed it', () => {
    renderImage()
    for (let i = 0; i < 20; i++) fireEvent.click(zoomInBtn()) // extra clicks
    expect(zoomLabel()).toHaveTextContent('500%')
  })
})

// ── Zoom out ───────────────────────────────────────────────────────────────────

describe('ImageRenderer — zoom out', () => {
  it('zoom − from fit mode uses 1.0 as base and shows 75%', () => {
    renderImage()
    fireEvent.click(zoomOutBtn())
    expect(zoomLabel()).toHaveTextContent('75%')
  })

  it('subsequent zoom − decrements by 0.25', () => {
    renderImage()
    fireEvent.click(zoomOutBtn()) // 0.75
    fireEvent.click(zoomOutBtn()) // 0.50
    expect(zoomLabel()).toHaveTextContent('50%')
  })

  it('− button is disabled at min scale 0.25', () => {
    renderImage()
    // fit → 0.75 → 0.50 → 0.25
    fireEvent.click(zoomOutBtn())
    fireEvent.click(zoomOutBtn())
    fireEvent.click(zoomOutBtn())
    expect(zoomLabel()).toHaveTextContent('25%')
    expect(zoomOutBtn()).toBeDisabled()
  })

  it('− clamps at 0.25 and does not go below it', () => {
    renderImage()
    for (let i = 0; i < 10; i++) fireEvent.click(zoomOutBtn()) // extra clicks
    expect(zoomLabel()).toHaveTextContent('25%')
  })
})

// ── Actual Size button ─────────────────────────────────────────────────────────

describe('ImageRenderer — Actual Size button', () => {
  it('sets scale to 1.0 from fit mode (shows 100%)', () => {
    renderImage()
    fireEvent.click(actualSizeBtn())
    expect(zoomLabel()).toHaveTextContent('100%')
  })

  it('resets scale from a zoomed state to 100%', () => {
    renderImage()
    fireEvent.click(zoomInBtn()) // 125%
    fireEvent.click(zoomInBtn()) // 150%
    fireEvent.click(actualSizeBtn())
    expect(zoomLabel()).toHaveTextContent('100%')
  })

  it('img uses width:100% after Actual Size', () => {
    renderImage()
    fireEvent.click(actualSizeBtn())
    expect(screen.getByRole('img')).toHaveStyle({ width: '100%' })
  })
})

// ── Fit button ─────────────────────────────────────────────────────────────────

describe('ImageRenderer — Fit button', () => {
  it('resets scale to 0 (shows Fit) from zoomed state', () => {
    renderImage()
    fireEvent.click(zoomInBtn()) // 125%
    fireEvent.click(fitBtn())
    expect(zoomLabel()).toHaveTextContent('Fit')
  })

  it('img returns to fit-mode style after Fit button', () => {
    renderImage()
    fireEvent.click(zoomInBtn())
    fireEvent.click(fitBtn())
    expect(screen.getByRole('img')).toHaveStyle({ maxWidth: '100%' })
  })

  it('Fit → zoom uses 1.0 as base again', () => {
    renderImage()
    fireEvent.click(zoomInBtn())  // 125%
    fireEvent.click(fitBtn())     // back to fit
    fireEvent.click(zoomInBtn())  // should be 125% again (1.0 + 0.25)
    expect(zoomLabel()).toHaveTextContent('125%')
  })
})

// ── Disabled button states ────────────────────────────────────────────────────

describe('ImageRenderer — button disabled states', () => {
  it('+ not disabled at scale 4.75', () => {
    renderImage()
    // reach 4.75: fit → 1.25 (1 click), then +0.25 × 14 = 3.5 more → 4.75
    for (let i = 0; i < 15; i++) fireEvent.click(zoomInBtn())
    expect(zoomLabel()).toHaveTextContent('475%')
    expect(zoomInBtn()).not.toBeDisabled()
  })

  it('− not disabled at scale 0.50', () => {
    renderImage()
    fireEvent.click(zoomOutBtn()) // 0.75
    fireEvent.click(zoomOutBtn()) // 0.50
    expect(zoomLabel()).toHaveTextContent('50%')
    expect(zoomOutBtn()).not.toBeDisabled()
  })
})

// ── Error state ────────────────────────────────────────────────────────────────

describe('ImageRenderer — image error state', () => {
  it('shows error message when img fires onError', () => {
    renderImage()
    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByText('Failed to load image')).toBeInTheDocument()
  })

  it('removes the img element after error', () => {
    renderImage()
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('controls bar remains visible after error', () => {
    renderImage()
    fireEvent.error(screen.getByRole('img'))
    expect(zoomInBtn()).toBeInTheDocument()
    expect(fitBtn()).toBeInTheDocument()
  })
})
