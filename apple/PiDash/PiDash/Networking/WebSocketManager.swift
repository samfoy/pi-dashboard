import Foundation

// MARK: - ConnectionState

enum ConnectionState: Equatable {
    case disconnected
    case connecting
    case connected
    case reconnecting(attempt: Int)
    case failed(String)

    var isConnected: Bool { self == .connected }

    var displayText: String {
        switch self {
        case .disconnected: return "Disconnected"
        case .connecting: return "Connecting…"
        case .connected: return "Connected"
        case .reconnecting(let n): return "Reconnecting… (attempt \(n))"
        case .failed(let msg): return "Connection failed: \(msg)"
        }
    }
}

// MARK: - ServerEvent

/// Decoded server events delivered from WebSocket to observers.
enum ServerEvent {
    case slots([ChatSlot])
    case chatChunk(slot: String, content: String, seq: Int?)
    case chatDone(slot: String)
    case chatMessage(slot: String, role: String, content: String, ts: String?, meta: MessageMetaDTO?)
    case toolCall(slot: String, tool: String, id: String, args: AnyCodable?)
    case toolResult(slot: String, tool: String, id: String, result: String?, isError: Bool)
    case toolUpdate(slot: String, tool: String?, id: String, partial: String)
    case heartbeat(slot: String, stallMs: Int?)
    case startupError(slot: String, content: String, ts: String?)
    case extensionStatus(slot: String, key: String, text: String?)
    case extensionWidget(slot: String, key: String, lines: [String])
    case slotTitle(key: String, title: String)
    case slotTags(key: String, tags: [String])
    case contextUsage(slot: String, tokens: Int?, percent: Double?)
    case tokenStats(slot: String, stats: TokenStatsDTO)
    case notification(kind: String, title: String, body: String?, slot: String?, ts: String)
    case chatError(slot: String, message: String)
    case unknown(String)
}

// MARK: - WebSocketManager

/// Manages the WebSocket connection to the pi-dashboard server with exponential backoff.
@MainActor
final class WebSocketManager: ObservableObject {
    // Published state
    @Published var connectionState: ConnectionState = .connecting

    // Event stream continuation
    private var eventContinuation: AsyncStream<ServerEvent>.Continuation?
    private(set) var events: AsyncStream<ServerEvent>

    private var wsTask: URLSessionWebSocketTask?
    private let urlSession: URLSession
    private var config: ServerConfig
    private var reconnectTask: Task<Void, Never>?
    private var heartbeatTask: Task<Void, Never>?
    private var reconnectAttempts = 0
    private let maxReconnectAttempts = 20
    private let pingInterval: TimeInterval = 10
    private let pongTimeout: TimeInterval = 5

    private var reconnectDelay: TimeInterval {
        min(pow(2.0, Double(reconnectAttempts)), 30.0)
    }

    init(config: ServerConfig = ServerConfig()) {
        self.config = config
        let sessionConfig = URLSessionConfiguration.default
        self.urlSession = URLSession(configuration: sessionConfig)

        var cont: AsyncStream<ServerEvent>.Continuation!
        self.events = AsyncStream { cont = $0 }
        self.eventContinuation = cont
    }

    // MARK: - Connect / Disconnect

    func connect(config: ServerConfig? = nil) {
        if let config { self.config = config }
        guard let url = self.config.wsURL else {
            connectionState = .failed("Invalid WebSocket URL")
            return
        }
        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            await self?.connectLoop(url: url)
        }
    }

    func disconnect() {
        reconnectTask?.cancel()
        heartbeatTask?.cancel()
        heartbeatTask = nil
        wsTask?.cancel(with: .normalClosure, reason: nil)
        wsTask = nil
        connectionState = .disconnected
    }

    func updateConfig(_ newConfig: ServerConfig) {
        disconnect()
        self.config = newConfig
        connect()
    }

    /// Called on scene-phase → .active. Force-reconnects if the WS is not in a
    /// healthy .connected state — handles zombie tasks that stopped delivering
    /// events without throwing (common when the OS suspends and resumes the app).
    func reconnectIfNeeded() {
        if connectionState.isConnected, wsTask?.state == .running {
            // Still healthy in theory — issue an out-of-band ping to force the
            // kernel to notice a dead socket if it is one.
            wsTask?.sendPing { [weak self] err in
                guard let self, err != nil else { return }
                Task { @MainActor in self.forceReconnect(reason: "resume ping failed") }
            }
            return
        }
        forceReconnect(reason: "resume not connected")
    }

    private func forceReconnect(reason: String) {
        print("[WS] Force reconnect: \(reason)")
        reconnectTask?.cancel()
        heartbeatTask?.cancel()
        heartbeatTask = nil
        wsTask?.cancel(with: .goingAway, reason: nil)
        wsTask = nil
        connect()
    }

    // MARK: - Internal loop

    private func connectLoop(url: URL) async {
        reconnectAttempts = 0
        while !Task.isCancelled && reconnectAttempts <= maxReconnectAttempts {
            await attemptConnection(url: url)
            if Task.isCancelled { break }
            reconnectAttempts += 1
            let delay = reconnectDelay
            let jitter = delay * Double.random(in: -0.25...0.25)
            connectionState = .reconnecting(attempt: reconnectAttempts)
            try? await Task.sleep(for: .seconds(max(0.5, delay + jitter)))
        }
        if reconnectAttempts > maxReconnectAttempts {
            connectionState = .failed("Max reconnect attempts reached")
        }
    }

    private func attemptConnection(url: URL) async {
        connectionState = .connecting
        let task = urlSession.webSocketTask(with: url)
        wsTask = task
        task.resume()
        connectionState = .connected
        reconnectAttempts = 0
        startHeartbeat(task: task)
        await receiveLoop(task: task)
        heartbeatTask?.cancel()
        heartbeatTask = nil
        // Don't set .disconnected here — connectLoop will set .reconnecting
    }

    /// Periodic ping with pong timeout. If a ping fails or no pong arrives
    /// within `pongTimeout`, tear down the socket so `receiveLoop` exits and
    /// `connectLoop` schedules a fresh reconnect. This is the only reliable
    /// way to detect a zombie URLSessionWebSocketTask on iOS — `receive()`
    /// will otherwise block forever on a half-dead connection.
    private func startHeartbeat(task: URLSessionWebSocketTask) {
        heartbeatTask?.cancel()
        heartbeatTask = Task { [weak self, weak task] in
            guard let self else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(self.pingInterval))
                if Task.isCancelled { break }
                guard let task, task === self.wsTask else { break }

                // Wrap sendPing in a checked continuation so we can time it out
                let result: Bool = await withCheckedContinuation { cont in
                    var resumed = false
                    let lock = NSLock()
                    task.sendPing { err in
                        lock.lock(); defer { lock.unlock() }
                        guard !resumed else { return }
                        resumed = true
                        cont.resume(returning: err == nil)
                    }
                    Task {
                        try? await Task.sleep(for: .seconds(self.pongTimeout))
                        lock.lock(); defer { lock.unlock() }
                        guard !resumed else { return }
                        resumed = true
                        cont.resume(returning: false)
                    }
                }

                if !result {
                    print("[WS] Heartbeat failed — forcing reconnect")
                    task.cancel(with: .goingAway, reason: nil)
                    // receiveLoop's `try await task.receive()` will throw, breaking the loop.
                    break
                }
            }
        }
    }

    private func receiveLoop(task: URLSessionWebSocketTask) async {
        while !Task.isCancelled {
            do {
                let message = try await task.receive()
                switch message {
                case .string(let text):
                    if let event = decode(text) {
                        print("[WS] Event: \(envelope(text))")
                        eventContinuation?.yield(event)
                    }
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8),
                       let event = decode(text) {
                        eventContinuation?.yield(event)
                    }
                @unknown default:
                    break
                }
            } catch {
                break
            }
        }
    }

    // MARK: - Decode

    /// All WS events from server use: `{ "type": "...", "data": { ... } }`
    /// or `{ "type": "slots", "data": [ ... ] }` (array data).
    private func decode(_ text: String) -> ServerEvent? {
        guard let rawData = text.data(using: .utf8) else { return nil }
        guard let envelope = try? JSONDecoder().decode(WSEnvelope.self, from: rawData) else {
            return .unknown(text)
        }

        // DTOs use explicit CodingKeys (API mixes snake_case and camelCase)
        let dec = JSONDecoder()

        switch envelope.type {
        case "slots":
            if let e = try? dec.decode(WSSlotsEvent.self, from: rawData) {
                return .slots(e.data.map { $0.toChatSlot() })
            }
        case "chat_chunk":
            if let e = try? dec.decode(WSChatChunkEvent.self, from: rawData) {
                return .chatChunk(slot: e.data.slot, content: e.data.content, seq: e.data.seq)
            }
        case "chat_done":
            if let e = try? dec.decode(WSChatDoneEvent.self, from: rawData) {
                return .chatDone(slot: e.data.slot)
            }
        case "chat_message":
            if let e = try? dec.decode(WSChatMessageEvent.self, from: rawData) {
                return .chatMessage(
                    slot: e.data.slot,
                    role: e.data.role,
                    content: e.data.content,
                    ts: e.data.ts,
                    meta: e.data.meta
                )
            }
        case "tool_call":
            if let e = try? dec.decode(WSToolCallEvent.self, from: rawData) {
                return .toolCall(slot: e.data.slot, tool: e.data.tool, id: e.data.id, args: e.data.args)
            }
        case "tool_result":
            if let e = try? dec.decode(WSToolResultEvent.self, from: rawData) {
                let resultStr = e.data.result?.jsonString
                return .toolResult(
                    slot: e.data.slot,
                    tool: e.data.tool,
                    id: e.data.id,
                    result: resultStr,
                    isError: e.data.isError ?? false
                )
            }
        case "tool_update":
            if let e = try? dec.decode(WSToolUpdateEvent.self, from: rawData) {
                return .toolUpdate(
                    slot: e.data.slot,
                    tool: e.data.tool,
                    id: e.data.id,
                    partial: e.data.partial ?? ""
                )
            }
        case "heartbeat":
            if let e = try? dec.decode(WSHeartbeatEvent.self, from: rawData) {
                return .heartbeat(slot: e.data.slot, stallMs: e.data.stallMs)
            }
        case "startup_error":
            if let e = try? dec.decode(WSStartupErrorEvent.self, from: rawData) {
                return .startupError(slot: e.data.slot, content: e.data.message.content, ts: e.data.message.ts)
            }
        case "extension_status":
            if let e = try? dec.decode(WSExtensionStatusEvent.self, from: rawData) {
                return .extensionStatus(slot: e.data.slot, key: e.data.key, text: e.data.text)
            }
        case "extension_widget":
            if let e = try? dec.decode(WSExtensionWidgetEvent.self, from: rawData) {
                return .extensionWidget(slot: e.data.slot, key: e.data.key, lines: e.data.lines ?? [])
            }
        case "slot_title":
            if let e = try? dec.decode(WSSlotTitleEvent.self, from: rawData) {
                return .slotTitle(key: e.data.key, title: e.data.title)
            }
        case "slot_tags":
            if let raw = try? dec.decode(WSSlotTagsEvent.self, from: rawData) {
                return .slotTags(key: raw.data.key, tags: raw.data.tags)
            }
        case "context_usage":
            if let e = try? dec.decode(WSContextUsageEvent.self, from: rawData) {
                return .contextUsage(slot: e.data.slot, tokens: e.data.tokens, percent: e.data.percent)
            }
        case "token_stats":
            if let e = try? dec.decode(WSTokenStatsEvent.self, from: rawData) {
                let stats = TokenStatsDTO(
                    totalInputTokens: e.data.totalInputTokens ?? 0,
                    totalOutputTokens: e.data.totalOutputTokens ?? 0,
                    totalTokens: (e.data.totalInputTokens ?? 0) + (e.data.totalOutputTokens ?? 0),
                    totalCost: e.data.totalCost ?? 0,
                    cacheReadTokens: e.data.cacheReadTokens ?? 0,
                    cacheWriteTokens: e.data.cacheWriteTokens ?? 0
                )
                return .tokenStats(slot: e.data.slot, stats: stats)
            }
        case "notification":
            if let e = try? dec.decode(WSNotificationEvent.self, from: rawData) {
                return .notification(
                    kind: e.data.kind,
                    title: e.data.title,
                    body: e.data.body,
                    slot: e.data.slot,
                    ts: e.data.ts ?? ""
                )
            }
        case "chat_error":
            if let e = try? dec.decode(WSChatErrorEvent.self, from: rawData) {
                return .chatError(slot: e.data.slot, message: e.data.message)
            }
        default:
            break
        }
        return .unknown(envelope.type)
    }

    // MARK: - Send

    /// Extract event type from raw JSON for logging
    private func envelope(_ text: String) -> String {
        if let d = text.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
           let type = obj["type"] as? String {
            if type == "chat_chunk", let data = obj["data"] as? [String: Any] {
                return "chat_chunk(slot:\(data["slot"] ?? "?"))"  
            }
            return type
        }
        return "unknown"
    }

    func send(_ text: String) async throws {
        try await wsTask?.send(.string(text))
    }
}
