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
    case chatMessage(slot: String, role: String, content: String, ts: Double?, meta: MessageMetaDTO?)
    case toolCall(slot: String, tool: String, id: String)
    case toolResult(slot: String, tool: String, id: String, isError: Bool)
    case slotTitle(key: String, title: String)
    case contextUsage(slot: String, tokens: Int?, percent: Double?)
    case unknown(String)
}

// MARK: - WebSocketManager

/// Manages the WebSocket connection to the pi-dashboard server with exponential backoff.
@MainActor
final class WebSocketManager: ObservableObject {
    // Published state
    @Published var connectionState: ConnectionState = .disconnected

    // Event stream continuation
    private var eventContinuation: AsyncStream<ServerEvent>.Continuation?
    private(set) var events: AsyncStream<ServerEvent>

    private var wsTask: URLSessionWebSocketTask?
    private let urlSession: URLSession
    private var config: ServerConfig
    private var reconnectTask: Task<Void, Never>?
    private var receiveTask: Task<Void, Never>?
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
        receiveTask?.cancel()
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

        // Wait briefly for actual connect (no async ping yet; rely on receive)
        connectionState = .connected
        reconnectAttempts = 0

        await receiveLoop(task: task)
        connectionState = .disconnected
    }

    private func receiveLoop(task: URLSessionWebSocketTask) async {
        while !Task.isCancelled {
            do {
                let message = try await task.receive()
                switch message {
                case .string(let text):
                    if let event = decode(text) {
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
                // Connection dropped — exit the receive loop, trigger reconnect
                break
            }
        }
    }

    // MARK: - Decode

    private func decode(_ text: String) -> ServerEvent? {
        guard let data = text.data(using: .utf8) else { return nil }
        guard let envelope = try? JSONDecoder().decode(WSEnvelope.self, from: data) else {
            return .unknown(text)
        }

        let decoder = JSONDecoder()
        switch envelope.type {
        case "slots":
            if let e = try? decoder.decode(WSSlotsEvent.self, from: data) {
                return .slots(e.slots.map { $0.toChatSlot() })
            }
        case "chat_chunk":
            if let e = try? decoder.decode(WSChatChunkEvent.self, from: data) {
                return .chatChunk(slot: e.slot, content: e.content, seq: e.seq)
            }
        case "chat_done":
            if let e = try? decoder.decode(WSChatDoneEvent.self, from: data) {
                return .chatDone(slot: e.slot)
            }
        case "chat_message":
            if let e = try? decoder.decode(WSChatMessageEvent.self, from: data) {
                return .chatMessage(slot: e.slot, role: e.role, content: e.content, ts: e.ts, meta: e.meta)
            }
        case "tool_call":
            if let e = try? decoder.decode(WSToolCallEvent.self, from: data) {
                return .toolCall(slot: e.slot, tool: e.tool, id: e.id)
            }
        case "tool_result":
            if let e = try? decoder.decode(WSToolResultEvent.self, from: data) {
                return .toolResult(slot: e.slot, tool: e.tool, id: e.id, isError: e.isError ?? false)
            }
        case "slot_title":
            if let e = try? decoder.decode(WSSlotTitleEvent.self, from: data) {
                return .slotTitle(key: e.key, title: e.title)
            }
        case "context_usage":
            if let e = try? decoder.decode(WSContextUsageEvent.self, from: data) {
                return .contextUsage(slot: e.slot, tokens: e.tokens, percent: e.percent)
            }
        default:
            break
        }
        return .unknown(envelope.type)
    }

    // MARK: - Send

    func send(_ text: String) async throws {
        try await wsTask?.send(.string(text))
    }
}
