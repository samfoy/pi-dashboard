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
    var pendingImages: [PendingImage] = []
    var isStreaming: Bool = false
    var isLoadingHistory: Bool = false
    var error: String?

    // Model & thinking
    var currentModel: ModelInfo?
    var thinkingLevel: String = "medium"
    var availableModels: [ModelInfo] = []
    var slashCommands: [SlashCommand] = []
    static let thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh"]

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
            let result = try await apiClient.fetchSlotDetail(key: slotKey)
            messages = result.messages
            // Sync streaming state with server — if server says not running, stop spinner
            if !result.running {
                isStreaming = false
                streamingMessageId = nil
            } else if let last = result.messages.last, last.role == .assistant, last.isStreaming {
                isStreaming = true
            }
        } catch is CancellationError {
            // SwiftUI task cancelled (view disappeared) — not a real error
        } catch let urlError as URLError where urlError.code == .cancelled {
            // Network request cancelled during navigation — ignore
        } catch let error as APIError {
            self.error = error.errorDescription ?? error.localizedDescription
        } catch where isCancellation(error) {
            // Catch-all cancellation guard
        } catch {
            self.error = "\(type(of: error)): \(error.localizedDescription)"
        }
        isLoadingHistory = false
        // If a skill command was queued for this slot (e.g. from the skills rail), send it now.
        if let cmd = appState?.consumePendingCommand(forSlot: slotKey) {
            inputText = cmd
            await send()
        }
    }

    // MARK: - Send message

    /// Sends a slash command (e.g. "compact" → sends "/compact" as a message).
    /// Handles both bare names ("compact") and prefixed names ("/compact").
    func sendCommand(_ name: String) async {
        inputText = name.hasPrefix("/") ? name : "/\(name)"
        await send()
    }

    func send() async {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        let images = pendingImages
        guard !isStreaming, (!text.isEmpty || !images.isEmpty) else { return }
        inputText = ""
        pendingImages = []
        HapticManager.messageSent()

        // Build user message content (include image indicators)
        var userContent = text
        if !images.isEmpty {
            let imgText = images.map { "![image](data:\($0.mimeType);base64,...)" }.joined(separator: "\n")
            userContent = text.isEmpty ? imgText : text + "\n" + imgText
        }
        let userMsg = ChatMessage(
            slotKey: slotKey,
            role: .user,
            content: userContent,
            imageData: images.map { $0.data }
        )
        messages.append(userMsg)

        // Prepare streaming assistant placeholder
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
            let imagePayloads = images.isEmpty ? nil : images.map { ImagePayload(data: $0.base64, mimeType: $0.mimeType) }
            try await apiClient.sendMessage(slot: slotKey, message: text, images: imagePayloads)
        } catch {
            self.error = error.localizedDescription
            messages.removeAll { $0.id == streamingId }
            isStreaming = false
            HapticManager.error()
        }
    }

    // MARK: - Stop generation

    func stop() async {
        do {
            try await apiClient.stopGeneration(slot: slotKey)
        } catch where isCancellation(error) {
            // ignore
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Model & Thinking

    func loadModels() async {
        do {
            let allModels = try await apiClient.fetchModels()
            // Exclude geographic-prefix duplicates (eu.*, global.*) — same model, different routing
            availableModels = allModels.filter { m in
                let id = m.id.lowercased()
                return !id.hasPrefix("eu.") && !id.hasPrefix("global.")
            }
        } catch {
            print("[ChatVM] Failed to load models: \(error)")
        }
    }

    func loadSlashCommands() async {
        do {
            slashCommands = try await apiClient.fetchSlashCommands()
        } catch {
            print("[ChatVM] Failed to load slash commands: \(error)")
        }
    }

    func setModel(_ model: ModelInfo) async {
        do {
            try await apiClient.setModel(slot: slotKey, provider: model.provider, modelId: model.modelId)
            currentModel = model
            HapticManager.messageSent()
        } catch where isCancellation(error) {
            // ignore
        } catch {
            self.error = error.localizedDescription
        }
    }

    func setThinking(_ level: String) async {
        do {
            try await apiClient.setThinking(slot: slotKey, level: level)
            thinkingLevel = level
            HapticManager.messageSent()
        } catch where isCancellation(error) {
            // ignore
        } catch {
            self.error = error.localizedDescription
        }
    }

    func rename(title: String) async {
        do {
            try await apiClient.renameSlot(key: slotKey, title: title)
            slot.title = title
            HapticManager.messageSent()
        } catch where isCancellation(error) {
            // ignore
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
            HapticManager.streamingComplete()
        case .chatMessage(let slot, let role, let content, let ts, let meta) where slot == slotKey:
            handleInboundMessage(role: role, content: content, ts: ts, meta: meta)
        case .chatError(let slot, let message) where slot == slotKey:
            finalizeStreaming()
            self.error = message
            HapticManager.error()
        case .toolCall(let slot, let tool, let id, let args) where slot == slotKey:
            handleToolCall(tool: tool, id: id, args: args)
        case .toolResult(let slot, _, let id, let result, let isError) where slot == slotKey:
            handleToolResult(tool: "", id: id, result: result, isError: isError)
        case .slotTitle(let key, let title) where key == slotKey:
            self.slot.title = title
        default:
            break
        }
    }

    // MARK: - Private streaming helpers

    private func appendStreamingChunk(_ chunk: String) {
        // If we have an existing streaming message, append to it
        if let id = streamingMessageId,
           let i = messages.firstIndex(where: { $0.id == id }) {
            messages[i].content += chunk
            isStreaming = true
            return
        }
        // No streaming message yet — create one (handles chunks arriving
        // before send() or for an already-running session)
        let newId = UUID()
        streamingMessageId = newId
        let msg = ChatMessage(
            id: newId,
            slotKey: slotKey,
            role: .assistant,
            content: chunk,
            isStreaming: true
        )
        messages.append(msg)
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

    private func handleInboundMessage(role: String, content: String, ts: String?, meta: MessageMetaDTO?) {
        let date = ts.flatMap { isoDate(from: $0) } ?? Date()
        let msgRole = MessageRole(rawValue: role) ?? .assistant
        let msg = ChatMessage(
            slotKey: slotKey,
            role: msgRole,
            content: content,
            timestamp: date,
            meta: meta.map {
                MessageMeta(
                    thinking: $0.thinking,
                    model: $0.model,
                    inputTokens: $0.inputTokens,
                    outputTokens: $0.outputTokens,
                    toolName: $0.toolName,
                    toolCallId: $0.toolCallId,
                    toolArgs: $0.args,
                    toolResult: $0.result,
                    isError: $0.isError
                )
            }
        )
        // thinking role → always append (they're separate blocks)
        if msgRole == .thinking {
            messages.append(msg)
            return
        }
        // If we have a streaming placeholder, replace it with final message
        if msgRole == .assistant, let id = streamingMessageId,
           let i = messages.firstIndex(where: { $0.id == id }) {
            messages[i] = msg
            streamingMessageId = nil
        } else {
            messages.append(msg)
        }
    }

    private func handleToolCall(tool: String, id: String, args: AnyCodable?) {
        // Finalize any open streaming text message (text chunk is done) but keep
        // isStreaming=true — the agent is still running (tool calls are mid-turn).
        if let sid = streamingMessageId,
           let i = messages.firstIndex(where: { $0.id == sid }) {
            messages[i].isStreaming = false
        }
        streamingMessageId = nil
        // Do NOT set isStreaming = false here — spinner must stay active during tool calls.

        let argsStr = args?.jsonString
        let msg = ChatMessage(
            slotKey: slotKey,
            role: .tool,
            content: "🔧 \(tool)",
            meta: MessageMeta(toolName: tool, toolCallId: id, toolArgs: argsStr)
        )
        messages.append(msg)
    }

    private func handleToolResult(tool: String, id: String, result: String?, isError: Bool) {
        // Find matching tool_call message by toolCallId
        if let i = messages.firstIndex(where: { $0.meta?.toolCallId == id }) {
            messages[i].meta?.toolResult = result
            messages[i].meta?.isError = isError
        }
    }
}

// MARK: - Helpers

private func isCancellation(_ error: Error) -> Bool {
    error is CancellationError || (error as? URLError)?.code == .cancelled
}

private func isoDate(from string: String) -> Date? {
    let fmt = ISO8601DateFormatter()
    fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = fmt.date(from: string) { return d }
    fmt.formatOptions = [.withInternetDateTime]
    return fmt.date(from: string)
}
