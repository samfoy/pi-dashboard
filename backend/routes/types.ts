/**
 * Shared types and dependencies for route modules.
 */
import type { Express, Request, Response } from 'express'
import type WebSocket from 'ws'
import type { FSWatcher } from 'fs'
import type { PiManager, PiProcess } from '../pi-manager.js'
import type { ChatMessage } from '../session-store.js'
import type { Notification } from '@shared/types.js'

export interface RouteDeps {
  app: Express
  manager: PiManager
  broadcast: (type: string, data: any) => void
  broadcastSlots: () => void
  persistSlots: () => void
  wsClients: Set<WebSocket>
  notifications: Notification[]
  addNotification: (notif: Omit<Notification, 'ts' | 'acked'>) => Notification
  wireSlotEvents: (pi: PiProcess, slotKey: string) => void

  // File collaboration state
  versionStore: Map<string, { version: number; content: string; timestamp: string }[]>
  recentWrites: Map<string, number>
  createVersion: (filePath: string, content: string) => number
  fileWatchers: Map<string, { watcher: FSWatcher; debounceTimer: ReturnType<typeof setTimeout> | null; clients: Set<WebSocket> }>
  startWatching: (filePath: string, ws: WebSocket) => void
  stopWatching: (filePath: string, ws: WebSocket) => void
  cleanupClientWatchers: (ws: WebSocket) => void

  // Shutdown helpers
  shutdownPty: () => void
}

export type { Request, Response, ChatMessage, PiProcess, PiManager, Notification }
