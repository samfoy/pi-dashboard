import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { j, api } from '../api/client'

describe('api client methods', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'ok' }),
      text: () => Promise.resolve(''),
    } as Response)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('status calls GET /api/status', async () => {
    await api.status()
    expect(fetch).toHaveBeenCalledWith('/api/status')
  })

  it('system calls GET /api/system', async () => {
    await api.system()
    expect(fetch).toHaveBeenCalledWith('/api/system')
  })

  it('chatSlots calls GET /api/chat/slots', async () => {
    await api.chatSlots()
    expect(fetch).toHaveBeenCalledWith('/api/chat/slots')
  })

  it('createChatSlot sends POST with name and agent', async () => {
    await api.createChatSlot('test-slot', 'claude')
    expect(fetch).toHaveBeenCalledWith('/api/chat/slots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test-slot', agent: 'claude' }),
    })
  })

  it('createChatSlot sends POST with empty body when no args', async () => {
    await api.createChatSlot()
    expect(fetch).toHaveBeenCalledWith('/api/chat/slots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
  })

  it('deleteChatSlot sends DELETE', async () => {
    await api.deleteChatSlot('slot-1')
    expect(fetch).toHaveBeenCalledWith('/api/chat/slots/slot-1', {
      method: 'DELETE',
      headers: undefined,
      body: undefined,
    })
  })

  it('sendChat sends POST with message and slot', async () => {
    await api.sendChat('hello', 'slot-1')
    expect(fetch).toHaveBeenCalledWith('/api/chat?ws=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello', slot: 'slot-1' }),
    })
  })

  it('chatSlotDetail builds query string correctly', async () => {
    await api.chatSlotDetail('slot-1', 100, 50)
    const call = vi.mocked(fetch).mock.calls[0]
    const url = call[0] as string
    expect(url).toContain('/api/chat/slots/slot-1')
    expect(url).toContain('limit=100')
    expect(url).toContain('before=50')
  })

  it('chatSlotDetail without optional params', async () => {
    await api.chatSlotDetail('slot-1')
    const call = vi.mocked(fetch).mock.calls[0]
    const url = call[0] as string
    expect(url).toContain('/api/chat/slots/slot-1')
  })

  it('chatMode sends POST with mode', async () => {
    await api.chatMode('yolo', 'slot-1')
    expect(fetch).toHaveBeenCalledWith('/api/chat/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'yolo', slot: 'slot-1' }),
    })
  })

  it('stopChatSlot sends POST', async () => {
    await api.stopChatSlot('slot-1')
    expect(fetch).toHaveBeenCalledWith('/api/chat/slots/slot-1/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: undefined,
    })
  })

  it('sessions passes limit and offset', async () => {
    await api.sessions(50, 10)
    expect(fetch).toHaveBeenCalledWith('/api/sessions?limit=50&offset=10')
  })

  it('browse with path', async () => {
    await api.browse('/home/user')
    const call = vi.mocked(fetch).mock.calls[0]
    const url = call[0] as string
    expect(url).toContain('/api/browse')
    expect(url).toContain('path=' + encodeURIComponent('/home/user'))
  })

  it('browse without path', async () => {
    await api.browse()
    expect(fetch).toHaveBeenCalledWith('/api/browse')
  })

  it('pathComplete encodes input', async () => {
    await api.pathComplete('/home/user/doc')
    const call = vi.mocked(fetch).mock.calls[0]
    const url = call[0] as string
    expect(url).toContain('/api/path-complete?input=')
  })

  it('renameSlot sends PATCH', async () => {
    await api.renameSlot('slot-1', 'New Title')
    expect(fetch).toHaveBeenCalledWith('/api/chat/slots/slot-1/title', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Title' }),
    })
  })

  it('deleteSession sends DELETE', async () => {
    await api.deleteSession('session-1')
    expect(fetch).toHaveBeenCalledWith('/api/sessions/session-1', {
      method: 'DELETE',
      headers: undefined,
      body: undefined,
    })
  })

  it('notifications calls GET /api/notifications', async () => {
    await api.notifications()
    expect(fetch).toHaveBeenCalledWith('/api/notifications')
  })

  it('models calls GET /api/models', async () => {
    await api.models()
    expect(fetch).toHaveBeenCalledWith('/api/models')
  })

  it('encodes slot key in URL for chatSlotAgent', async () => {
    await api.chatSlotAgent('slot with spaces', 'agent-1')
    const call = vi.mocked(fetch).mock.calls[0]
    const url = call[0] as string
    expect(url).toContain(encodeURIComponent('slot with spaces'))
  })
})

describe('j error handling edge cases', () => {
  it('includes error text in thrown error message', async () => {
    const resp = {
      ok: false,
      status: 422,
      text: () => Promise.resolve('Validation failed: name is required'),
      json: vi.fn(),
    } as unknown as Response
    await expect(j(resp)).rejects.toThrow('Validation failed: name is required')
  })
})
