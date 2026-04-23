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
    case slotTitle(key: String, title: String)
    case contextUsage(slot: String, tokens: Int?, percent: Double?)
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
    private var reconnectAttempts = 0
    private let maxReconnectAttempts = 20

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
        wsTask?.cancel(with: .normalClosure, reason: nil)
        wsTask = nil
        connectionState = .disconnected
    }

    func updateConfig(_ newConfig: ServerConfig) {
        disconnect()
        self.config = newConfig
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
        await receiveLoop(task: task)
        // Don't set .disconnected here — connectLoop will set .reconnecting
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
        case "slot_title":
            if let e = try? dec.decode(WSSlotTitleEvent.self, from: rawData) {
                return .slotTitle(key: e.data.key, title: e.data.title)
            }
        case "context_usage":
            if let e = try? dec.decode(WSContextUsageEvent.self, from: rawData) {
                return .contextUsage(slot: e.data.slot, tokens: e.data.tokens, percent: e.data.percent)
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
