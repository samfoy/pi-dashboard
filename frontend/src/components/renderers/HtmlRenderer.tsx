import { useEffect, useRef } from 'react'

/**
 * Renders a locally-generated HTML artifact inside a sandboxed, opaque-origin
 * iframe with its JavaScript actually running (tabs, Mermaid, hljs, …).
 *
 * Security: sandbox WITHOUT `allow-same-origin`, so the frame gets a null origin
 * and cannot touch the dashboard's DOM/cookies/localStorage. Its `fetch` to the
 * un-authed mutation API is separately blocked by the backend `sameOriginOnly`
 * guard (Origin: null → 403).
 *
 * Commenting: the parent cannot read a selection made inside an opaque-origin
 * frame, so a small BRIDGE script is appended to the artifact. It captures the
 * in-frame selection and postMessages the selected text out. The parent
 * validates `event.source === iframe.contentWindow` (event.origin is the useless
 * string "null" for sandboxed frames) and reverse-maps the text to source lines.
 */
function withBridge(html: string): string {
  return html + `<script>(function(){
    document.addEventListener('mouseup', function(){
      var s = window.getSelection();
      if (!s || s.isCollapsed) return;
      var text = s.toString();
      if (!text.trim()) return;
      parent.postMessage({ __picomment: true, kind: 'selection', text: text }, '*');
    });
  })()<\/script>`
}

interface Props {
  content: string
  onSelect?: (text: string) => void
  /** Bumps to force a full iframe remount on live-reload (guarantees script re-exec). */
  reloadKey?: number
}

export default function HtmlRenderer({ content, onSelect, reloadKey }: Props) {
  const ref = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!onSelect) return
    function onMsg(e: MessageEvent) {
      // Trust only messages from OUR frame's window. event.origin is 'null' for a
      // sandboxed frame and must NOT be trusted.
      if (e.source !== ref.current?.contentWindow) return
      const d = e.data
      if (d && d.__picomment && d.kind === 'selection' && typeof d.text === 'string') {
        onSelect?.(d.text)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [onSelect])

  return (
    <iframe
      key={reloadKey}
      ref={ref}
      title="HTML preview"
      srcDoc={withBridge(content)}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      className="w-full h-full border-0 bg-white rounded-md"
    />
  )
}
