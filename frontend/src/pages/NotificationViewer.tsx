import { useState, useEffect } from 'react'
import { useAppDispatch } from '../store'
import { deleteNotification, ackNotification, unackNotification } from '../store/notificationsSlice'
import { switchSlot } from '../store/chatSlice'
import { api } from '../api/client'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { CronAckBar } from './chat'
import type { Notification } from '../types'

function parseNotificationTs(ts: string): string {
  let d = new Date(ts)
  if (isNaN(d.getTime())) {
    const epoch = parseFloat(ts)
    if (!isNaN(epoch)) d = new Date(epoch * 1000)
  }
  return isNaN(d.getTime()) ? '' : d.toLocaleString()
}

interface NotificationViewerProps {
  notification: Notification
  onClose: () => void
  dispatch: ReturnType<typeof useAppDispatch>
}

export default function NotificationViewer({ notification, onClose, dispatch }: NotificationViewerProps) {
  const [manualUnread, setManualUnread] = useState(false)

  // Auto-ack after 2s of viewing (unless user marked unread)
  useEffect(() => {
    if (notification.acked || manualUnread) return
    const t = setTimeout(() => dispatch(ackNotification(notification.ts)), 2000)
    return () => clearTimeout(t)
  }, [notification, manualUnread, dispatch])

  // Sync from Redux store (e.g. after auto-ack)
  // Note: parent should pass updated notification prop when store changes

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-5 py-2.5 border-b border-border flex justify-between items-center bg-chrome">
        <span className="text-sm font-semibold text-text">
          {notification.kind === 'cron' ? '⏰' : notification.kind === 'approval' ? '🔐' : notification.kind === 'input_needed' ? '💬' : notification.kind === 'tool_done' ? '🔧' : '🤖'} {notification.title}
        </span>
        <div className="flex gap-2">
          {notification.acked && (
            <button className="bg-transparent border border-border text-muted rounded-md px-3 py-[5px] text-[13px] font-medium cursor-pointer hover:text-text hover:border-border-strong hover:bg-bg-hover transition-all font-body" onClick={() => { dispatch(unackNotification(notification.ts)); setManualUnread(true) }}>📩 Mark as unread</button>
          )}
          <button className="bg-transparent border border-border text-muted rounded-md px-3 py-[5px] text-[13px] font-medium cursor-pointer hover:text-text hover:border-border-strong hover:bg-bg-hover transition-all font-body" onClick={onClose}>✕ Close</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="text-muted text-[13px] font-mono mb-3">{parseNotificationTs(notification.ts)}</div>
        <div className="msg-content bg-card border border-border rounded-lg px-5 py-4 text-sm leading-relaxed text-text shadow-[inset_0_1px_0_var(--card-hl)] max-w-[820px] overflow-x-auto break-words">
          <MarkdownRenderer content={notification.body || ''} />
          {notification.kind === 'approval' && (
            <div className="flex gap-3 mt-4 pt-3 border-t border-border">
              <button className="px-4 py-2 rounded-lg bg-ok text-white text-[13px] font-semibold cursor-pointer border-none hover:brightness-110 transition-all" onClick={async () => { await api.resolveApproval(notification.ts, 'approve'); dispatch(deleteNotification(notification.ts)); onClose() }}>✅ Approve</button>
              <button className="px-4 py-2 rounded-lg bg-danger text-white text-[13px] font-semibold cursor-pointer border-none hover:brightness-110 transition-all" onClick={async () => { await api.resolveApproval(notification.ts, 'reject'); dispatch(deleteNotification(notification.ts)); onClose() }}>🚫 Reject</button>
            </div>
          )}
          {notification.kind === 'cron' && notification.job_id && (
            <CronAckBar key={notification.ts} notification={notification} onDone={onClose} />
          )}
          {(notification.kind === 'input_needed' || notification.kind === 'tool_done') && notification.slot && (
            <div className="flex gap-3 mt-4 pt-3 border-t border-border">
              <button className="px-4 py-2 rounded-lg bg-accent text-white text-[13px] font-semibold cursor-pointer border-none hover:brightness-110 transition-all" onClick={() => {
                dispatch(switchSlot(notification.slot!))
                onClose()
              }}>{notification.kind === 'input_needed' ? '💬 Go to Session' : '🔧 Go to Session'}</button>
            </div>
          )}
          {notification.kind === 'taskrunner' && notification.task_id && (
            <div className="flex gap-3 mt-4 pt-3 border-t border-border">
              <button className="px-4 py-2 rounded-lg bg-accent text-white text-[13px] font-semibold cursor-pointer border-none hover:brightness-110 transition-all" onClick={async () => {
                const res = await api.taskRunToChat(notification.task_id!)
                if (res.slot) { dispatch(switchSlot(res.slot)); onClose() }
              }}>💬 Continue in Chat</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
