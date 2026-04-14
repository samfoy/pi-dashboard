import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'

describe('useKeyboardShortcuts', () => {
  it('fires action on matching key', () => {
    const action = vi.fn()
    renderHook(() => useKeyboardShortcuts([{ key: 'k', ctrl: true, label: 'Test', action }]))
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    expect(action).toHaveBeenCalledOnce()
  })

  it('does not fire without required modifier', () => {
    const action = vi.fn()
    renderHook(() => useKeyboardShortcuts([{ key: 'k', ctrl: true, label: 'Test', action }]))
    fireEvent.keyDown(document, { key: 'k' })
    expect(action).not.toHaveBeenCalled()
  })

  it('treats metaKey same as ctrlKey', () => {
    const action = vi.fn()
    renderHook(() => useKeyboardShortcuts([{ key: 'n', ctrl: true, label: 'Test', action }]))
    fireEvent.keyDown(document, { key: 'n', metaKey: true })
    expect(action).toHaveBeenCalledOnce()
  })

  it('ignores keystrokes in input elements (except Escape)', () => {
    const action = vi.fn()
    renderHook(() => useKeyboardShortcuts([{ key: '/', label: 'Help', action }]))

    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: '/' })
    expect(action).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('allows Escape in input elements', () => {
    const action = vi.fn()
    renderHook(() => useKeyboardShortcuts([{ key: 'Escape', label: 'Close', action }]))

    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(action).toHaveBeenCalledOnce()
    document.body.removeChild(input)
  })

  it('matches shift modifier', () => {
    const action = vi.fn()
    renderHook(() => useKeyboardShortcuts([{ key: 'k', ctrl: true, shift: true, label: 'Test', action }]))

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    expect(action).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true, shiftKey: true })
    expect(action).toHaveBeenCalledOnce()
  })
})
