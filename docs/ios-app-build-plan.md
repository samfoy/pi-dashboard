# Pi Dash iOS App — Build Plan

## Overview
Native SwiftUI iOS app that connects to the pi-dashboard backend via Tailscale.
Premium polish matching ChatGPT/Claude iOS apps.

## Target
- iOS 17+, iPhone-focused (iPad bonus)
- Swift 5.9+, SwiftUI with @Observable macro
- Xcode project at `~/pi-dashboard/ios/PiDash/`

## Architecture
- **MVVM** with @Observable view models
- **Networking**: URLSessionWebSocketTask + async/await
- **State**: Single `AppState` @Observable, per-slot `ChatViewModel`
- **Markdown**: MarkdownUI (gonzalezreal/swift-markdown-ui) + Highlightr for code syntax
- **No external deps beyond**: MarkdownUI, Highlightr (via SPM)

## Server Connection
- Base URL configurable (default: `http://100.103.130.31:7777`)
- WebSocket at `ws://{host}/api/ws`
- REST at `http://{host}/api/...`
- Auto-reconnect with exponential backoff
- Connection status indicator in UI

## Key Screens

### 1. Chat List (Main)
- Navigation split view or list → push
- Temporal grouping: Today / Yesterday / Last 7 Days / Older by month
- Each row: title, last message preview, relative timestamp
- Swipe to delete
- New chat button in nav bar (+ icon)
- Pull to refresh
- Search bar

### 2. Chat View
- Reversed scroll (newest at bottom)
- User messages: right-aligned, accent-colored bubbles
- Assistant messages: left-aligned, card/flat style, pi avatar
- Streaming: text appears chunk-by-chunk with typing cursor
- Tool calls: collapsible cards (🔧 tool name, expandable details)
- Thinking indicator: animated dots with rotating labels
- Auto-scroll during streaming, pause on manual scroll up
- "Jump to bottom" FAB when scrolled up
- Haptic on message send, message received

### 3. Input Area
- Growing textarea (1-5 lines, then scroll)
- Send button (arrow icon, appears when text entered)
- Accent-colored send button with spring animation
- Keyboard avoidance (native SwiftUI)
- Stop button when streaming (replaces send)

### 4. Settings
- Server URL configuration
- Connection status
- Theme (auto/light/dark)

## File Structure
```
ios/PiDash/
├── PiDash.xcodeproj/
├── PiDash/
│   ├── PiDashApp.swift
│   ├── Models/
│   │   ├── ChatMessage.swift
│   │   ├── ChatSlot.swift
│   │   └── SessionInfo.swift
│   ├── Networking/
│   │   ├── APIClient.swift
│   │   ├── WebSocketManager.swift
│   │   └── ServerConfig.swift
│   ├── ViewModels/
│   │   ├── AppState.swift
│   │   ├── ChatViewModel.swift
│   │   └── SlotListViewModel.swift
│   ├── Views/
│   │   ├── Chat/
│   │   │   ├── ChatView.swift
│   │   │   ├── MessageBubble.swift
│   │   │   ├── StreamingTextView.swift
│   │   │   ├── ToolCallView.swift
│   │   │   ├── ThinkingIndicator.swift
│   │   │   └── ChatInputBar.swift
│   │   ├── SlotList/
│   │   │   ├── SlotListView.swift
│   │   │   └── SlotRow.swift
│   │   ├── Settings/
│   │   │   └── SettingsView.swift
│   │   └── Common/
│   │       ├── ConnectionBanner.swift
│   │       └── EmptyStateView.swift
│   ├── Utilities/
│   │   ├── HapticManager.swift
│   │   ├── RelativeTimeFormatter.swift
│   │   └── MarkdownTheme.swift
│   └── Assets.xcassets/
└── Package.swift (or via Xcode SPM)
```

## API Endpoints Used (from api-reference.md)
- `GET /api/chat/slots` — list active slots
- `POST /api/chat/slots` — create slot
- `DELETE /api/chat/slots/:key` — delete slot
- `GET /api/chat/slots/:key` — slot detail + messages
- `POST /api/chat` — send message
- `POST /api/chat/slots/:key/stop` — stop generation
- `GET /api/sessions` — history list
- `POST /api/chat/slots/:key/resume` — resume session
- `WS /api/ws` — real-time events (chat_chunk, chat_done, tool_call, tool_result, slots, etc.)

## Polish Details (from ios-ux-spec.md)
- Spring animations on message appearance (mass: 0.5, stiffness: 200)
- Light haptic on send, medium on response complete
- Streaming cursor (blinking pipe character)
- Code blocks with language label + copy button + syntax highlighting
- Connection lost → amber banner at top
- Empty state with friendly illustration text
- Dark mode: pure black background, elevated cards
