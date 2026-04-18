# iOS Chat App — Technical Research (April 2026)

> Research for building a premium AI chat iOS app in SwiftUI, targeting iOS 17+.

---

## 1. Markdown Rendering Options

### Option A: `swift-markdown-ui` (gonzalezreal) — ⭐ 3,807

**Status: Maintenance mode.** New development moved to **Textual** (see Option B).

| Feature | Support |
|---|---|
| Headings, bold, italic, strikethrough | ✅ Full |
| Links, images | ✅ Full |
| Code blocks (fenced + indented) | ✅ Full |
| Tables | ✅ (iOS 16+) |
| Task lists | ✅ |
| Blockquotes | ✅ |
| GitHub Flavored Markdown | ✅ |
| Syntax highlighting (code blocks) | 🔌 Plugin via `CodeSyntaxHighlighter` protocol |
| Theming | ✅ Excellent — `.gitHub`, `.basic`, or fully custom |
| Text selection | ⚠️ Limited — uses SwiftUI `Text` under the hood |
| LaTeX / math | ❌ Not built-in |

**Strengths:**
- Mature, battle-tested (3.8k stars)
- Works on iOS 15+ (great backward compat)
- Fully SwiftUI-native rendering
- Rich theming: `markdownTheme()`, `markdownBlockStyle()`, `markdownTextStyle()` modifiers
- `CodeSyntaxHighlighter` protocol allows plugging in Splash/Highlightr
- `MarkdownContent` pre-parsing — good for models that need to avoid re-parsing

**Limitations:**
- Now in maintenance mode — no new features
- Code block syntax highlighting requires a third-party library (Splash, Highlightr)
- No native text selection support (underlying `Text` views)
- Splash only highlights Swift well; other languages are basic
- Performance with very long markdown can be sluggish (full re-render on updates)

**Verdict:** Still a solid choice for iOS 17 targets. Well-documented, easy to integrate. Good enough for a v1 with the understanding that you may migrate to Textual later.

### Option B: `Textual` (gonzalezreal) — ⭐ 589

**Status: Active development.** Spiritual successor to swift-markdown-ui. First release Dec 2025.

| Feature | Support |
|---|---|
| `InlineText` (drop-in `Text` replacement) | ✅ |
| `StructuredText` (full block documents) | ✅ |
| Syntax highlighting (code blocks) | ✅ Built-in — uses Prism.js via JavaScriptCore |
| Custom highlighter themes | ✅ |
| Math expressions (LaTeX) | ✅ `.math` syntax extension |
| Custom emoji | ✅ |
| Text selection with copy-paste | ✅ Native |
| Animated images (GIF, APNG, WebP) | ✅ |
| Custom markup parsers | ✅ `MarkupParser` protocol |
| Font-relative measurements | ✅ `.fontScaled()` |

**Strengths:**
- Built-in syntax highlighting via Prism.js (supports 100+ languages)
- Native text selection with proper copy-paste
- Two view types: `InlineText` (lightweight) and `StructuredText` (full documents)
- Much better architecture than MarkdownUI — designed from lessons learned
- Math rendering support
- Customizable per-block styling with protocols (`HeadingStyle`, `CodeBlockStyle`, etc.)
- Font-relative layout system — scales with Dynamic Type automatically

**Limitations:**
- ⚠️ **Requires iOS 18+** (Swift tools version 6.0, platforms: .iOS(.v18))
- Still young (v0.3.1, ~600 stars) — may have edge cases
- Fewer community examples/tutorials
- API may still evolve (pre-1.0)

**Verdict:** The future of Swift markdown rendering. If targeting iOS 18+ is acceptable, this is the superior choice. Built-in syntax highlighting alone saves significant integration work. For iOS 17 target, it's not usable.

### Option C: `AttributedString` with Markdown init (built-in)

```swift
let attributed = try AttributedString(markdown: "**Bold** and *italic*")
Text(attributed)
```

| Feature | Support |
|---|---|
| Bold, italic, strikethrough, code | ✅ |
| Links | ✅ (tappable) |
| Headers | ⚠️ Parsed but no visual distinction |
| Lists | ⚠️ Parsed but no formatting |
| Code blocks | ❌ No syntax highlighting, no block styling |
| Tables | ❌ |
| Images | ❌ |
| Custom styling | ⚠️ Limited — can iterate attributes |

**Strengths:**
- Zero dependencies — built into Foundation
- Lightweight, fast
- Good for simple inline formatting (bold, italic, links, code spans)
- Works great for individual message text that doesn't need full markdown

**Limitations:**
- No block-level rendering (headings all look the same, no list formatting)
- No images, tables, or code block styling
- Not suitable for rich AI chat responses with code blocks

**Verdict:** Good for simple inline formatting (e.g., user messages), but not sufficient for rendering AI assistant responses with code blocks, headers, lists, etc.

### Option D: Custom Rendering with Apple's `swift-markdown` Parser

```swift
import Markdown
let doc = Document(parsing: markdownString)
// Walk the AST and build SwiftUI views
```

Apple's `swift-markdown` (⭐ 3,284) provides a full Markdown AST parser. You can walk the tree and build custom SwiftUI views for each node.

**Strengths:**
- Full control over rendering
- Apple-maintained parser
- Can optimize for streaming (incremental parsing)
- Can build exactly the UI you want

**Limitations:**
- Significant implementation effort
- Must handle every Markdown node type yourself
- Easy to miss edge cases
- Reinventing what MarkdownUI already does well

**Verdict:** Only worthwhile if you have very specific rendering needs that no library covers. Not recommended for initial development.

### Syntax Highlighting for Code Blocks

#### Splash (JohnSundell) — ⭐ 1,871
- **Best for Swift code** — extremely accurate Swift tokenizer
- Written in pure Swift, no JS bridge
- Only really handles Swift well; other languages are basic
- Has a `TextOutputFormat` that returns SwiftUI `Text`
- MarkdownUI has built-in integration example via `CodeSyntaxHighlighter` protocol
- Last release: actively maintained

#### Highlightr — ⭐ 1,857
- Wraps **highlight.js** via JavaScriptCore
- Supports **189 languages** with **89 themes**
- Returns `NSAttributedString` (needs UIKit bridge or conversion)
- More overhead than Splash due to JS runtime
- Better multi-language support than Splash
- Works via `UITextView` wrapper or AttributedString conversion

#### Textual's Built-in (Prism.js)
- Uses **Prism.js** bundled via JavaScriptCore
- Wide language support out of the box
- Integrated directly — no extra setup
- Custom `HighlighterTheme` protocol for theming
- Only available with Textual (iOS 18+)

#### Recommended Approach for iOS 17+
1. **Primary:** Use **MarkdownUI** with **Highlightr** for multi-language syntax highlighting
2. Custom `CodeSyntaxHighlighter` implementation wrapping Highlightr
3. Convert Highlightr's `NSAttributedString` → SwiftUI `Text` via `AttributedString`
4. Cache highlighted results to avoid re-highlighting during scroll

```swift
struct HighlightrCodeSyntaxHighlighter: CodeSyntaxHighlighter {
    let highlightr = Highlightr()!
    
    func highlightCode(_ content: String, language: String?) -> Text {
        highlightr.setTheme(to: "atom-one-dark")
        guard let language = language,
              let highlighted = highlightr.highlight(content, as: language) else {
            return Text(content).font(.system(.body, design: .monospaced))
        }
        return Text(AttributedString(highlighted))
    }
}
```

### What ChatGPT / Claude Likely Use

Both ChatGPT and Claude iOS apps almost certainly use **custom rendering pipelines**:

- **ChatGPT iOS:** Likely a custom Markdown→SwiftUI renderer built on Apple's `swift-markdown` parser or a similar AST approach. Evidence: their code blocks have custom copy buttons, language labels, line numbers, and syntax highlighting that doesn't match any open-source library exactly. They probably use a WebView (`WKWebView`) or custom native approach for code blocks specifically. The streaming text animation suggests they render incrementally as tokens arrive.

- **Claude iOS:** Similar custom approach. The rendering has specific styling for "thinking" blocks, artifacts, and code that suggests a bespoke solution. The smooth streaming animation with markdown that "fills in" progressively is characteristic of a custom incremental renderer.

**Key insight:** Both apps likely use a **hybrid approach** — native SwiftUI `Text` for simple inline content, with specialized views for code blocks (possibly `UITextView` with syntax highlighting or even small `WKWebView` instances). This gives them the performance of native text for most content while having rich rendering for code.

---

## 2. WebSocket in Swift

### URLSessionWebSocketTask (Recommended for iOS 17+)

The modern, Apple-native approach. Available since iOS 13 but significantly improved since.

```swift
class WebSocketManager {
    private var webSocketTask: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)
    
    func connect(to url: URL) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            let task = session.webSocketTask(with: url)
            self.webSocketTask = task
            task.resume()
            
            continuation.onTermination = { _ in
                task.cancel(with: .goingAway, reason: nil)
            }
            
            func receiveMessage() {
                task.receive { result in
                    switch result {
                    case .success(let message):
                        switch message {
                        case .string(let text):
                            continuation.yield(text)
                        case .data(let data):
                            if let text = String(data: data, encoding: .utf8) {
                                continuation.yield(text)
                            }
                        @unknown default:
                            break
                        }
                        receiveMessage() // Continue receiving
                    case .failure(let error):
                        continuation.finish(throwing: error)
                    }
                }
            }
            receiveMessage()
        }
    }
    
    func send(_ message: String) async throws {
        try await webSocketTask?.send(.string(message))
    }
    
    func disconnect() {
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
    }
}
```

**Strengths:**
- Zero dependencies — built into Foundation
- Handles TLS/SSL automatically
- Proper integration with URLSession (auth, cookies, proxies)
- Supports ping/pong for keep-alive
- Works with Swift Concurrency natively
- Background URLSession support for iOS background modes

**Limitations:**
- No built-in auto-reconnect (must implement yourself)
- Slightly verbose API for the receive loop
- No built-in heartbeat management
- Older iOS versions had some bugs (fixed by iOS 15+)

### Starscream — ⭐ 8,641

Third-party WebSocket library. Last release: v4.0.8 (March 2024).

**Strengths:**
- Mature, widely used
- Custom headers support
- Compression support (permessage-deflate)
- Delegate-based API (familiar pattern)

**Limitations:**
- External dependency for something Apple now provides natively
- Delegate pattern doesn't mesh well with Swift Concurrency
- v4 had some stability issues reported
- Less actively maintained recently (last release over 2 years ago)
- Doesn't add much over URLSessionWebSocketTask for modern iOS

### Verdict: Use `URLSessionWebSocketTask`

For iOS 17+, there's no compelling reason to use Starscream. URLSessionWebSocketTask is mature, well-integrated, and works perfectly with async/await. Build a thin wrapper around it.

### Reconnection with Exponential Backoff

```swift
actor WebSocketConnection {
    private var task: URLSessionWebSocketTask?
    private let url: URL
    private let session: URLSession
    private var reconnectAttempts = 0
    private let maxReconnectAttempts = 10
    private var isConnected = false
    
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)
    private var reconnectDelay: TimeInterval {
        min(pow(2.0, Double(reconnectAttempts)), 30.0)
    }
    
    func connect() async throws -> AsyncThrowingStream<ServerMessage, Error> {
        AsyncThrowingStream { continuation in
            Task {
                while reconnectAttempts < maxReconnectAttempts {
                    do {
                        let task = session.webSocketTask(with: url)
                        self.task = task
                        task.resume()
                        self.isConnected = true
                        self.reconnectAttempts = 0 // Reset on success
                        
                        try await receiveLoop(task: task, continuation: continuation)
                    } catch {
                        self.isConnected = false
                        self.reconnectAttempts += 1
                        
                        let delay = self.reconnectDelay
                        // Add jitter: ±25%
                        let jitter = delay * Double.random(in: -0.25...0.25)
                        try? await Task.sleep(for: .seconds(delay + jitter))
                    }
                }
                continuation.finish(throwing: WebSocketError.maxRetriesExceeded)
            }
        }
    }
    
    private func receiveLoop(
        task: URLSessionWebSocketTask,
        continuation: AsyncThrowingStream<ServerMessage, Error>.Continuation
    ) async throws {
        while task.state == .running {
            let message = try await task.receive()
            switch message {
            case .string(let text):
                if let serverMessage = try? JSONDecoder().decode(ServerMessage.self, from: Data(text.utf8)) {
                    continuation.yield(serverMessage)
                }
            default: break
            }
        }
    }
}
```

### Key patterns:
- **Jitter** on backoff delays prevents thundering herd on server recovery
- **Reset counter** on successful connection
- **Cap maximum delay** at 30 seconds
- **Use `actor`** for thread-safe state management
- **Ping/pong** for detecting dead connections:

```swift
// Heartbeat via ping
func startPingTimer() {
    Task {
        while isConnected {
            try? await Task.sleep(for: .seconds(30))
            task?.sendPing { error in
                if let error {
                    // Connection dead — trigger reconnect
                    self.handleDisconnect()
                }
            }
        }
    }
}
```

### AsyncStream Integration Pattern

```swift
// In the ViewModel
@Observable
class ChatViewModel {
    var messages: [ChatMessage] = []
    var isConnected = false
    private var connection: WebSocketConnection?
    
    func startListening() async {
        do {
            let stream = try await connection?.connect()
            for try await serverMessage in stream ?? .finished {
                await MainActor.run {
                    handleMessage(serverMessage)
                }
            }
        } catch {
            isConnected = false
        }
    }
    
    @MainActor
    private func handleMessage(_ message: ServerMessage) {
        switch message.type {
        case .token:
            // Append streaming token to current message
            if let last = messages.last, last.isStreaming {
                messages[messages.count - 1].content += message.content
            }
        case .done:
            if let last = messages.last {
                messages[messages.count - 1].isStreaming = false
            }
        case .error:
            // Handle error
            break
        }
    }
}
```

---

## 3. Chat UI Patterns in SwiftUI

### Reversed ScrollView vs List

#### Option A: Reversed `ScrollView` + `LazyVStack` (Recommended ✅)

```swift
ScrollViewReader { proxy in
    ScrollView {
        LazyVStack(spacing: 12) {
            ForEach(messages) { message in
                MessageBubble(message: message)
                    .id(message.id)
            }
        }
        .padding()
    }
    .defaultScrollAnchor(.bottom) // iOS 17+ — game changer!
    .onChange(of: messages.last?.content) { _, _ in
        withAnimation(.easeOut(duration: 0.15)) {
            proxy.scrollTo(messages.last?.id, anchor: .bottom)
        }
    }
}
```

**Strengths:**
- `defaultScrollAnchor(.bottom)` (iOS 17+) eliminates the need for "reversed" hacks
- Full control over layout and spacing
- `LazyVStack` = good performance with many messages
- `ScrollViewReader` for programmatic scrolling
- No cell reuse weirdness
- Easy to add custom animations per message

**Limitations:**
- Must manually handle scroll position
- No built-in swipe actions
- Need to implement pull-to-load-more yourself

#### Option B: `List` 

**Strengths:**
- Built-in cell reuse
- Swipe actions
- Separator handling

**Limitations:**
- Harder to customize appearance (insets, separators)
- `List` styling fights against you for chat bubbles
- Can't easily do `defaultScrollAnchor(.bottom)`
- Performance is actually not better than `LazyVStack` for typical chat volumes
- Harder to animate individual messages

**Verdict:** Use **ScrollView + LazyVStack** with `defaultScrollAnchor(.bottom)`. This is the modern SwiftUI chat pattern.

### Smooth Auto-Scroll During Streaming

The key challenge: scrolling during streaming without jank or fighting the user.

```swift
struct ChatView: View {
    @State private var isUserScrolledUp = false
    @State private var autoScrollEnabled = true
    
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(viewModel.messages) { message in
                        MessageBubble(message: message)
                            .id(message.id)
                    }
                    // Invisible anchor at the bottom
                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                }
                .padding()
            }
            .defaultScrollAnchor(.bottom)
            .onScrollGeometryChange(for: Bool.self) { geometry in
                // User is "scrolled up" if more than 100pt from bottom
                let distanceFromBottom = geometry.contentSize.height 
                    - geometry.contentOffset.y 
                    - geometry.containerSize.height
                return distanceFromBottom > 100
            } action: { _, isScrolledUp in
                isUserScrolledUp = isScrolledUp
            }
            .onChange(of: viewModel.streamingText) { _, _ in
                // Only auto-scroll if user hasn't scrolled up
                if !isUserScrolledUp {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
        }
    }
}
```

**Key techniques:**
- Use `onScrollGeometryChange` (iOS 18) or a `GeometryReader` overlay to detect user scroll position
- **Don't animate** the scroll during streaming — use instant scroll to avoid jitter
- Only auto-scroll when user is near the bottom
- Show a "scroll to bottom" button when user scrolls up
- Use the invisible `Color.clear` anchor at the bottom for reliable scrolling

**iOS 17 approach** (without `onScrollGeometryChange`):
```swift
// Use a GeometryReader inside the ScrollView to track position
.background(
    GeometryReader { geometry in
        Color.clear.preference(
            key: ScrollOffsetKey.self,
            value: geometry.frame(in: .named("scroll")).maxY
        )
    }
)
.coordinateSpace(name: "scroll")
.onPreferenceChange(ScrollOffsetKey.self) { maxY in
    // Calculate if near bottom
}
```

### Streaming Text Animation

#### Approach A: Chunk Append (Recommended ✅)

The most practical approach — append text chunks as they arrive from the WebSocket.

```swift
@Observable
class StreamingMessage {
    var content: String = ""
    var isStreaming: Bool = true
    
    func appendToken(_ token: String) {
        // Simple append — the Markdown renderer re-renders
        content += token
    }
}
```

The markdown view naturally re-renders as content changes. This is what ChatGPT and Claude do — tokens arrive and text grows. No need for character-by-character animation.

**Polish touches:**
- Use `.contentTransition(.numericText())` on simple text for smooth transitions
- Add a blinking cursor indicator at the end while streaming:

```swift
struct StreamingIndicator: View {
    @State private var isVisible = true
    
    var body: some View {
        Circle()
            .fill(Color.accentColor)
            .frame(width: 8, height: 8)
            .opacity(isVisible ? 1 : 0)
            .animation(.easeInOut(duration: 0.5).repeatForever(), value: isVisible)
            .onAppear { isVisible.toggle() }
    }
}
```

#### Approach B: Character-by-character (⚠️ Not recommended for markdown)

Only suitable for plain text, not for markdown content (re-parsing incomplete markdown causes rendering glitches). Can be used for a typewriter effect on simple status messages.

#### Approach C: Opacity Fade-in per Paragraph

New paragraphs/blocks appear with a subtle fade:

```swift
MessageBubble(message: message)
    .transition(.opacity.combined(with: .move(edge: .bottom)))
    .animation(.easeOut(duration: 0.2), value: message.content.count)
```

### Keyboard Avoidance

SwiftUI's built-in keyboard avoidance (iOS 15+) works reasonably well but needs help for chat:

```swift
struct ChatView: View {
    @FocusState private var isInputFocused: Bool
    
    var body: some View {
        VStack(spacing: 0) {
            // Message list
            messageList
            
            // Input bar
            ChatInputBar(isFocused: $isInputFocused)
        }
        // iOS 17+ built-in avoidance works when structure is right
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { isInputFocused = false }
            }
        }
    }
}
```

**Key rules for reliable keyboard avoidance:**
1. Put the input field at the **bottom of a VStack**, not inside the ScrollView
2. Don't use `ignoresSafeArea(.keyboard)` unless you're handling it manually
3. Use `@FocusState` for keyboard management
4. The ScrollView should naturally shrink when keyboard appears
5. **Scroll to bottom** when keyboard appears:

```swift
.onChange(of: isInputFocused) { _, focused in
    if focused {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            withAnimation {
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        }
    }
}
```

6. For additional control, use `.safeAreaInset(edge: .bottom)` for the input bar:

```swift
ScrollView { ... }
    .safeAreaInset(edge: .bottom) {
        ChatInputBar()
            .background(.bar) // UIKit blur material
    }
```

This is actually the best pattern — the ScrollView automatically adjusts its content area.

### Dynamic Cell Heights with Streaming Content

```swift
// LazyVStack handles this automatically — cells resize as content changes
// Key: make sure message ID stays stable during streaming

struct MessageBubble: View {
    let message: ChatMessage
    
    var body: some View {
        HStack {
            if message.role == .user { Spacer(minLength: 60) }
            
            VStack(alignment: .leading, spacing: 4) {
                // Use MarkdownUI for assistant messages
                if message.role == .assistant {
                    Markdown(message.content)
                        .markdownTheme(.custom)
                } else {
                    Text(message.content)
                }
                
                if message.isStreaming {
                    StreamingIndicator()
                }
            }
            .padding(12)
            .background(message.role == .user ? Color.accentColor : Color(.systemGray6))
            .clipShape(RoundedRectangle(cornerRadius: 16))
            
            if message.role == .assistant { Spacer(minLength: 60) }
        }
        .id(message.id) // Stable ID during streaming
    }
}
```

**Important:** The message `id` must remain **stable** during streaming. Don't create new message objects — mutate the existing one. This prevents LazyVStack from destroying/recreating the cell.

---

## 4. Architecture

### @Observable (iOS 17+) — Recommended ✅

```swift
@Observable
class ChatViewModel {
    var messages: [ChatMessage] = []
    var currentInput: String = ""
    var isConnected: Bool = false
    var isStreaming: Bool = false
    var error: ChatError?
    
    private let chatService: ChatService
    private let messageStore: MessageStore
    
    init(chatService: ChatService, messageStore: MessageStore) {
        self.chatService = chatService
        self.messageStore = messageStore
    }
    
    func send() async {
        let userMessage = ChatMessage(role: .user, content: currentInput)
        messages.append(userMessage)
        currentInput = ""
        
        let assistantMessage = ChatMessage(role: .assistant, content: "", isStreaming: true)
        messages.append(assistantMessage)
        isStreaming = true
        
        do {
            for try await token in chatService.stream(messages: messages) {
                messages[messages.count - 1].content += token
            }
            messages[messages.count - 1].isStreaming = false
        } catch {
            self.error = .streamingFailed(error)
        }
        isStreaming = false
    }
}
```

**Why @Observable over ObservableObject:**
- **Granular observation** — only views that read specific properties re-render
- **No `@Published` boilerplate** — just use regular properties
- **Better performance** — SwiftUI tracks exactly which properties each view reads
- **Simpler code** — no `objectWillChange.send()` shenanigans
- **Works with `let` in views** — no need for `@ObservedObject` or `@StateObject`

```swift
struct ChatView: View {
    let viewModel: ChatViewModel // Just a regular let!
    
    var body: some View {
        // Only re-renders when messages or isStreaming actually change
        ...
    }
}
```

### Networking Layer Structure

```
Sources/
  Services/
    ChatService.swift           // Protocol + implementation
    WebSocketManager.swift      // WebSocket connection management
    APIClient.swift             // REST API for auth, history, etc.
  Models/
    ChatMessage.swift
    ServerMessage.swift
    ChatSlot.swift
  ViewModels/
    ChatViewModel.swift
    ChatListViewModel.swift
  Views/
    ChatView.swift
    MessageBubble.swift
    ChatInputBar.swift
    ChatListView.swift
```

```swift
// Protocol-based service layer
protocol ChatService: Sendable {
    func stream(messages: [ChatMessage]) -> AsyncThrowingStream<String, Error>
    func cancelStream()
}

// WebSocket implementation
final class WebSocketChatService: ChatService {
    private let wsManager: WebSocketManager
    
    func stream(messages: [ChatMessage]) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            Task {
                try await wsManager.send(StreamRequest(messages: messages))
                
                for try await message in wsManager.messages {
                    switch message {
                    case .token(let text):
                        continuation.yield(text)
                    case .done:
                        continuation.finish()
                    case .error(let error):
                        continuation.finish(throwing: error)
                    }
                }
            }
        }
    }
}

// REST fallback (SSE) implementation
final class SSEChatService: ChatService {
    func stream(messages: [ChatMessage]) -> AsyncThrowingStream<String, Error> {
        // Use URLSession with SSE for environments without WebSocket
        ...
    }
}
```

### State Management for Multiple Chat Slots

```swift
@Observable
class ChatStore {
    var chats: [ChatSlot] = []
    var activeChat: ChatSlot?
    
    private let persistence: ChatPersistence
    
    func createNewChat() -> ChatSlot {
        let slot = ChatSlot(id: UUID(), title: "New Chat", messages: [])
        chats.insert(slot, at: 0)
        activeChat = slot
        return slot
    }
    
    func loadChats() async {
        chats = await persistence.loadAllChats()
        activeChat = chats.first
    }
    
    func viewModel(for chat: ChatSlot) -> ChatViewModel {
        // Factory method — each chat gets its own ViewModel
        ChatViewModel(
            chatSlot: chat,
            chatService: chatService,
            onUpdate: { [weak self] updatedSlot in
                // Sync back to store
                if let index = self?.chats.firstIndex(where: { $0.id == updatedSlot.id }) {
                    self?.chats[index] = updatedSlot
                }
            }
        )
    }
}

@Observable
class ChatSlot: Identifiable {
    let id: UUID
    var title: String
    var messages: [ChatMessage]
    var lastActivity: Date
    var model: AIModel
}
```

### Offline / Reconnection Handling

```swift
@Observable
class ConnectionMonitor {
    var isOnline: Bool = true
    var connectionQuality: ConnectionQuality = .good
    
    private let monitor = NWPathMonitor()
    
    func start() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.isOnline = path.status == .satisfied
                self?.connectionQuality = path.isExpensive ? .poor : .good
            }
        }
        monitor.start(queue: .global())
    }
}

// In ChatViewModel:
func handleConnectionChange(isOnline: Bool) {
    if isOnline && !isConnected {
        Task { await reconnect() }
    }
    if !isOnline {
        // Queue messages for later
        // Show offline banner
    }
}
```

**Offline strategy:**
1. **NWPathMonitor** to detect network changes
2. **Queue unsent messages** in local storage (SwiftData or UserDefaults)
3. **Auto-reconnect** when network returns
4. **Show clear UI indicators** for connection state
5. **Persist chat history** locally for offline reading

---

## 5. Premium Polish Techniques

### Spring Animations for Message Appearance

```swift
// Message appears with a spring bounce
MessageBubble(message: message)
    .transition(
        .asymmetric(
            insertion: .move(edge: .bottom)
                .combined(with: .opacity)
                .combined(with: .scale(scale: 0.95)),
            removal: .opacity
        )
    )
    .animation(
        .spring(duration: 0.4, bounce: 0.2),
        value: messages.count
    )
```

**Best practices:**
- Use `.spring(duration:bounce:)` (iOS 17+) — much cleaner API
- Keep bounce subtle (0.1–0.3) for professional feel
- Different animations for user vs assistant messages:
  - User: slide from right + slight scale
  - Assistant: fade in from bottom

### Haptic Feedback

```swift
enum HapticManager {
    static func messageSent() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
    
    static func messageReceived() {
        UIImpactFeedbackGenerator(style: .soft).impactOccurred()
    }
    
    static func error() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }
    
    static func selectionChanged() {
        UISelectionFeedbackGenerator().selectionChanged()
    }
    
    static func streamingComplete() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
}

// Usage:
func send() async {
    HapticManager.messageSent()
    // ... send logic
}
```

**When to use haptics:**
- ✅ Sending a message (light impact)
- ✅ Message received / streaming complete (soft impact or success notification)
- ✅ Switching chats (selection feedback)
- ✅ Long press on message (medium impact)
- ✅ Copy to clipboard (success notification)
- ❌ Don't vibrate on every streaming token — annoying
- ❌ Don't overuse — less is more

### Custom Transitions

```swift
// Slide-up modal for new chat
struct SlideUpTransition: ViewModifier {
    let isPresented: Bool
    
    func body(content: Content) -> some View {
        content
            .offset(y: isPresented ? 0 : UIScreen.main.bounds.height)
            .opacity(isPresented ? 1 : 0)
            .animation(.spring(duration: 0.5, bounce: 0.15), value: isPresented)
    }
}

// Chat bubble typing indicator
struct TypingIndicator: View {
    @State private var phase = 0.0
    
    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3) { index in
                Circle()
                    .fill(Color.secondary)
                    .frame(width: 8, height: 8)
                    .offset(y: sin(phase + Double(index) * .pi / 1.5) * 4)
            }
        }
        .onAppear {
            withAnimation(.linear(duration: 1.0).repeatForever(autoreverses: false)) {
                phase = .pi * 2
            }
        }
    }
}
```

### Blur / Vibrancy Effects

```swift
// Input bar with blur background
struct ChatInputBar: View {
    @Binding var text: String
    
    var body: some View {
        HStack(spacing: 12) {
            TextField("Message", text: $text, axis: .vertical)
                .lineLimit(1...6)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
            
            Button(action: send) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.white, Color.accentColor)
            }
            .disabled(text.isEmpty)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
    }
}

// Navigation bar with vibrancy
.toolbarBackground(.ultraThinMaterial, for: .navigationBar)
.toolbarBackground(.visible, for: .navigationBar)
```

**Material options by feel:**
- `.ultraThinMaterial` — very subtle, lets most content through (Apple Messages style)
- `.thinMaterial` — slightly more opaque
- `.regularMaterial` — balanced (good for input fields)
- `.bar` — system bar material (matches native toolbars)

### Matching Apple's Design Feel

1. **Use SF Symbols** — always use system symbols, not custom icons
2. **Respect Dynamic Type** — use `.font(.body)`, `.font(.caption)`, etc.
3. **Use semantic colors** — `Color(.systemBackground)`, `Color(.secondaryLabel)`, not hardcoded colors
4. **Subtle shadows** — `.shadow(color: .black.opacity(0.06), radius: 8, y: 2)`
5. **Safe area respect** — never ignore safe areas unless intentional
6. **Native navigation** — `NavigationStack`, not custom navigation
7. **System materials** — use `.regularMaterial` not custom blur effects
8. **Smooth corners** — `.clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))`
9. **Content transitions** — `.contentTransition(.numericText())` for changing numbers
10. **Responsive layout** — iPad split view, landscape adaptation
11. **Animation curves** — use `.spring` not `.linear` or `.easeInOut` for interactions
12. **Reduced motion** — respect `@Environment(\.accessibilityReduceMotion)`:

```swift
@Environment(\.accessibilityReduceMotion) var reduceMotion

.animation(reduceMotion ? .none : .spring(duration: 0.4, bounce: 0.2), value: trigger)
```

---

## 6. Dependencies to Consider

### Recommended Dependencies

| Package | Purpose | Why |
|---|---|---|
| **swift-markdown-ui** | Markdown rendering | Best iOS 17-compatible option; proven, well-themed |
| **Highlightr** | Code syntax highlighting | 189 languages, 89 themes — much better than Splash for multi-lang |
| **KeychainAccess** (kishikawakatsumi) | Secure token storage | Simpler API than raw Keychain |
| **swift-dependencies** (pointfreeco) | Dependency injection | Clean DI for testing, previews |

### Consider but Optional

| Package | Purpose | Notes |
|---|---|---|
| **Textual** (gonzalezreal) | Markdown rendering | Only if targeting iOS 18+; superior to MarkdownUI |
| **SwiftData** | Local persistence | Built-in, but can be buggy; consider SQLite/GRDB as backup |
| **Nuke** (kean) | Image loading/caching | Only if chat includes images beyond markdown |
| **exyte/Chat** | Chat UI framework | Provides scaffolding but may limit customization |

### Build Custom (Don't Use a Library)

| Component | Why Custom |
|---|---|
| **WebSocket layer** | URLSessionWebSocketTask is sufficient; thin wrapper is better than a dependency |
| **Chat UI layout** | ScrollView + LazyVStack with your design; libraries are too opinionated |
| **Input bar** | Easy to build, needs to match your exact design |
| **Navigation** | NavigationStack is good enough |
| **State management** | @Observable + simple patterns; no need for TCA/Redux complexity |
| **Networking (REST)** | URLSession + async/await; no need for Alamofire |
| **Animation** | SwiftUI's built-in animation system is excellent |

### Minimal Dependency Strategy

For a premium chat app, the sweet spot is:
1. **MarkdownUI + Highlightr** for rendering (these save the most time)
2. **Everything else custom** using Apple frameworks

This keeps the dependency footprint small (2 packages) while avoiding the most tedious custom work (markdown parsing and syntax highlighting).

### If Targeting iOS 18+ Instead

If you can bump the target to iOS 18+:
1. Replace MarkdownUI + Highlightr with just **Textual** (1 dependency instead of 2)
2. Use `onScrollGeometryChange` for better scroll tracking
3. Use `ScrollPosition` type for more precise scroll control
4. Access improved `@Observable` features

---

## Summary: Recommended Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| **Min Target** | iOS 17+ | Balances modern APIs with reach |
| **Markdown** | swift-markdown-ui (MarkdownUI 2.4) | Proven, iOS 17 compatible, great theming |
| **Syntax Highlighting** | Highlightr | 189 languages vs Splash's Swift-only |
| **WebSocket** | URLSessionWebSocketTask | Native, zero-dep, async/await ready |
| **Architecture** | @Observable + MVVM | Granular updates, clean separation |
| **Chat UI** | ScrollView + LazyVStack | `defaultScrollAnchor(.bottom)`, full control |
| **Input** | TextField + `.safeAreaInset` | Best keyboard avoidance pattern |
| **Persistence** | SwiftData (with SQLite fallback) | Native, lightweight |
| **Animations** | SwiftUI springs + haptics | Professional feel, respects accessibility |
| **Navigation** | NavigationStack + NavigationSplitView | Native iPad/iPhone adaptation |

### Migration Path
Start with MarkdownUI (iOS 17) → migrate to Textual when comfortable requiring iOS 18+. The rendering layer should be abstracted behind a protocol so swapping is straightforward.
