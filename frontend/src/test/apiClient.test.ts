import { describe, it, expect, vi, beforeEach } from 'vitest'
import { j } from '../api/client'

describe('j (response helper)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns parsed JSON for ok responses', async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ data: 'test' }),
      text: vi.fn(),
    } as unknown as Response
    const result = await j(mockResponse)
    expect(result).toEqual({ data: 'test' })
    expect(mockResponse.json).toHaveBeenCalled()
  })

  it('throws on non-ok response with error text', async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      text: vi.fn().mockResolvedValue('Not found'),
      json: vi.fn(),
    } as unknown as Response
    await expect(j(mockResponse)).rejects.toThrow('Not found')
  })

  it('throws with HTTP status when error text is empty', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue(''),
      json: vi.fn(),
    } as unknown as Response
    await expect(j(mockResponse)).rejects.toThrow('HTTP 500')
  })

  it('throws with HTTP status for 403', async () => {
    const mockResponse = {
      ok: false,
      status: 403,
      text: vi.fn().mockResolvedValue(''),
      json: vi.fn(),
    } as unknown as Response
    await expect(j(mockResponse)).rejects.toThrow('HTTP 403')
  })
})
