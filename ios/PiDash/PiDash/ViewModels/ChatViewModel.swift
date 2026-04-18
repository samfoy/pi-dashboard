import Foundation

// MARK: - ChatViewModel

/// View model for a single chat slot — handles messages, streaming, and input.
@MainActor
@Observable
final class ChatViewModel {
    let slotKey: String
    var slot: ChatSlot
    var messages: [ChatMessage] = []
    var inputText: String = ""
    var isStreaming: Bool = false
    var isLoadingHistory: Bool = false
    var error: String?

    private let apiClient: APIClient
    private weak var appState: AppState?
    private var streamingMessageId: UUID?

    init(slot: ChatSlot, apiClient: APIClient, appState: AppState) {
        self.slotKey = slot.key
        self.slot = slot
        self.apiClient = apiClient
        self.appState = appState
    }

    // MARK: - Load history

    func loadHistory() async {
        isLoadingHistory = true
        error = nil
        do {
            let (updatedSlot, msgs) = try await apiClient.fetchSlotDetail(key: slotKey)
            slot = updatedSlot
            messages = msgs
        } catch {
            self.error = error.localizedDescription
        }
        isLoadingHistory = false
    }

    // MARK: - Send message

    func send() async {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isStreaming else { return }
        inputText = ""

        // Add user message immediately
        let userMsg = ChatMessage(slotKey: slotKey, role: .user, content: text)
        messages.append(userMsg)

        // Prepare streaming assistant message
        let streamingId = UUID()
        streamingMessageId = streamingId
        let assistantMsg = ChatMessage(
            id: streamingId,
            slotKey: slotKey,
            role: .assistant,
            content: "",
            isStreaming: true
        )
        messages.append(assistantMsg)
        isStreaming = true

        do {
            try await apiClient.sendMessage(slot: slotKey, message: text)
        } catch {
            self.error = error.localizedDescription
            // Remove the empty assistant placeholder
            messages.removeAll { $0.id == streamingId }
            isStreaming = false
        }
    }

    // MARK: - Stop generation

    func stop() async {
        do {
            try await apiClient.stopGeneration(slot: slotKey)
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - WebSocket event handling

    func handle(event: ServerEvent) {
        switch event {
        case .chatChunk(let slot, let content, _) where slot == slotKey:
            appendStreamingChunk(content)
        case .chatDone(let slot) where slot == slotKey:
            finalizeStreaming()
        case .chatMessage(let slot, let role, let content, let ts, let meta) where slot == slotKey:
            handleInboundMessage(role: role, content: content, ts: ts, meta: meta)
        case .slotTitle(let key, let title) where key == slotKey:
            self.slot.title = title
        default:
            break
        }
    }

    private func appendStreamingChunk(_ chunk: String) {
        guard let id = streamingMessageId,
              let i = messages.firstIndex(where: { $0.id == id }) else { return }
        messages[i].content += chunk
        isStreaming = true
    }

    private func finalizeStreaming() {
        if let id = streamingMessageId,
           let i = messages.firstIndex(where: { $0.id == id }) {
            messages[i].isStreaming = false
        }
        streamingMessageId = nil
        isStreaming = false
    }

    private func handleInboundMessage(role: String, content: String, ts: Double?, meta: MessageMetaDTO?) {
        // Avoid duplicating streaming messages
        let date = ts.map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date()
        let msg = ChatMessage(
            slotKey: slotKey,
            role: MessageRole(rawValue: role) ?? .assistant,
            content: content,
            timestamp: date,
            meta: meta.map {
                MessageMeta(thinking: $0.thinking, model: $0.model,
                           inputTokens: $0.inputTokens, outputTokens: $0.outputTokens)
            }
        )
        // If we have a streaming placeholder, replace it
        if role == "assistant", let id = streamingMessageId,
           let i = messages.firstIndex(where: { $0.id == id }) {
            messages[i] = msg
            streamingMessageId = nil
        } else {
            // Avoid duplicate if already present
            if !messages.contains(where: {
                $0.role.rawValue == role && $0.content == content
            }) {
                messages.append(msg)
            }
        }
    }
}
