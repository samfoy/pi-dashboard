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
    var tokenStats: TokenStatsDTO?
    /// When non-nil, pi has been silent for this many ms but is still alive (heartbeat).
    /// UI can render “still working…” badge on the spinner.
    var heartbeatStallMs: Int?

    // Model & thinking
    var currentModel: ModelInfo?
    var thinkingLevel: String = "xhigh"
    var availableModels: [ModelInfo] = []
    var slashCommands: [SlashCommand] = []
    var gitSummary: GitSummaryDTO?
    static let thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh"]

    private let apiClient: APIClient
    private weak var appState: AppState?
    private var streamingMessageId: UUID?
    /// Timestamp of last chunk/event observed — fed to the streaming watchdog.
    private var lastStreamEventAt: Date = .distantPast
    private var watchdogTask: Task<Void, Never>?
    /// Suppress overlapping background reloads.
    private var backgroundReloadInFlight = false

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
            tokenStats = result.tokenStats
            // Sync thinking level from server (source of truth)
            if let serverLevel = result.thinkingLevel, ChatViewModel.thinkingLevels.contains(serverLevel) {
                thinkingLevel = serverLevel
            }
            // Sync streaming state with server — if server says not running, stop spinner
            if !result.running {
                isStreaming = false
                streamingMessageId = nil
            } else if let last = result.messages.last, last.role == .assistant, last.isStreaming {
                isStreaming = true
                startStreamingWatchdog()
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
        guard !text.isEmpty || !images.isEmpty else { return }
        let isFollowUp = isStreaming
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
            isQueued: isFollowUp,
            imageData: images.map { $0.data }
        )
        messages.append(userMsg)

        // For follow-ups the current stream's assistant placeholder is already present;
        // the queued message will begin streaming into a fresh placeholder when pi
        // starts processing the next turn (handled in appendStreamingChunk).
        if !isFollowUp {
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
            lastStreamEventAt = Date()
            startStreamingWatchdog()
        }

        do {
            let imagePayloads = images.isEmpty ? nil : images.map { ImagePayload(data: $0.base64, mimeType: $0.mimeType) }
            try await apiClient.sendMessage(slot: slotKey, message: text, images: imagePayloads)
        } catch {
            self.error = error.localizedDescription
            if !isFollowUp {
                messages.removeAll { $0.id == streamingMessageId }
                isStreaming = false
            } else {
                // Roll back the queued user message on send failure
                messages.removeAll { $0.id == userMsg.id }
            }
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

    func refreshGitSummary() async {
        do {
            gitSummary = try await apiClient.fetchGitSummary(slot: slotKey)
        } catch {
            // Best-effort — silently swallow. Rendering guards on isRepo.
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

    /// Ask the server to auto-generate a concise title from recent messages.
    func autoTitle() async {
        do {
            let newTitle = try await apiClient.generateTitle(slot: slotKey)
            slot.title = newTitle
            HapticManager.messageSent()
        } catch where isCancellation(error) {
            // ignore
        } catch {
            self.error = error.localizedDescription
            HapticManager.error()
        }
    }

    // MARK: - WebSocket reconnect handler

    /// Called by AppState when the WS transitions from not-connected → connected.
    /// Pulls the latest slot detail via HTTP to backfill any chunks/events that
    /// arrived on the server while we were offline (server does not replay).
    func handleReconnect() {
        backgroundReload(reason: "ws reconnected")
    }

    /// HTTP-fetch the current slot state without disturbing the UI (no spinner).
    /// Merges in any messages missing from our local view while preserving the
    /// currently-streaming placeholder.
    private func backgroundReload(reason: String) {
        guard !backgroundReloadInFlight else { return }
        backgroundReloadInFlight = true
        Task {
            defer { Task { @MainActor in self.backgroundReloadInFlight = false } }
            do {
                let result = try await apiClient.fetchSlotDetail(key: slotKey)
                await MainActor.run {
                    self.reconcileMessages(result.messages, running: result.running)
                    if let stats = result.tokenStats { self.tokenStats = stats }
                    print("[ChatVM] backgroundReload (\(reason)) → \(result.messages.count) msgs, running=\(result.running)")
                }
            } catch {
                // Quiet — best-effort backfill.
                print("[ChatVM] backgroundReload failed: \(error.localizedDescription)")
            }
        }
    }

    /// Replace `messages` with the server view, but preserve any in-flight
    /// streaming assistant placeholder so we don't wipe the cursor the user is
    /// watching. After reload, if the server reports the slot is idle and we
    /// still thought we were streaming, clear the streaming state.
    private func reconcileMessages(_ serverMessages: [ChatMessage], running: Bool) {
        // If we have a streaming placeholder whose content is ahead of or equal
        // to the server's last assistant message, keep ours; otherwise take server.
        if let sid = streamingMessageId, let localIdx = messages.firstIndex(where: { $0.id == sid }) {
            let localStreaming = messages[localIdx]
            var merged = serverMessages
            // If server doesn't yet have our streaming placeholder, append it.
            let lastServerAssistant = merged.last(where: { $0.role == .assistant })
            if lastServerAssistant == nil || (lastServerAssistant?.content.count ?? 0) < localStreaming.content.count {
                merged.append(localStreaming)
            }
            messages = merged
        } else {
            messages = serverMessages
        }
        if !running {
            // Server says not streaming — finalize our state too.
            if let sid = streamingMessageId, let i = messages.firstIndex(where: { $0.id == sid }) {
                messages[i].isStreaming = false
            }
            streamingMessageId = nil
            isStreaming = false
            heartbeatStallMs = nil
        }
    }

    /// Start a watchdog that triggers a backgroundReload if we believe we're
    /// streaming but haven't seen any event for `stallSeconds`. This is the
    /// safety net for gaps the heartbeat alone can't paper over (e.g. events
    /// lost during a reconnect window, or SwiftUI observation misses).
    private func startStreamingWatchdog() {
        watchdogTask?.cancel()
        watchdogTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                if Task.isCancelled { break }
                await MainActor.run {
                    guard let self else { return }
                    guard self.isStreaming else { return }
                    let idle = Date().timeIntervalSince(self.lastStreamEventAt)
                    if idle > 20 {
                        self.backgroundReload(reason: "watchdog idle \(Int(idle))s")
                        self.lastStreamEventAt = Date()  // debounce
                    }
                }
            }
        }
    }

    private func stopStreamingWatchdog() {
        watchdogTask?.cancel()
        watchdogTask = nil
    }

    deinit {
        // Note: watchdogTask is MainActor-isolated. It's fine if it leaks a
        // final tick — the Task's weak self capture terminates it safely.
    }

    // MARK: - WebSocket event handling

    func handle(event: ServerEvent) {
        // Any slot-scoped event counts as liveness for the watchdog.
        switch event {
        case .chatChunk(let slot, _, _),
             .chatMessage(let slot, _, _, _, _),
             .toolCall(let slot, _, _, _),
             .toolResult(let slot, _, _, _, _),
             .toolUpdate(let slot, _, _, _),
             .heartbeat(let slot, _),
             .chatDone(let slot):
            if slot == slotKey { lastStreamEventAt = Date() }
        default: break
        }
        switch event {
        case .chatChunk(let slot, let content, _) where slot == slotKey:
            appendStreamingChunk(content)
        case .chatDone(let slot) where slot == slotKey:
            finalizeStreaming()
            HapticManager.streamingComplete()
            Task { await self.refreshGitSummary() }
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
        case .toolUpdate(let slot, _, let id, let partial) where slot == slotKey:
            handleToolUpdate(id: id, partial: partial)
        case .heartbeat(let slot, let stallMs) where slot == slotKey:
            heartbeatStallMs = stallMs
        case .startupError(let slot, let content, let ts) where slot == slotKey:
            finalizeStreaming()
            let date = ts.flatMap { isoDate(from: $0) } ?? Date()
            messages.append(ChatMessage(
                slotKey: slotKey,
                role: .system,
                content: content,
                timestamp: date
            ))
            HapticManager.error()
        case .slotTitle(let key, let title) where key == slotKey:
            self.slot.title = title
        case .tokenStats(let slot, let stats) where slot == slotKey:
            self.tokenStats = stats
        default:
            break
        }
    }

    // MARK: - Private streaming helpers

    private func appendStreamingChunk(_ chunk: String) {
        // Any real chunk clears the heartbeat stall indicator.
        heartbeatStallMs = nil
        lastStreamEventAt = Date()
        startStreamingWatchdog()
        // If we have an existing streaming message, append to it
        if let id = streamingMessageId,
           let i = messages.firstIndex(where: { $0.id == id }) {
            messages[i].content += chunk
            isStreaming = true
            return
        }
        // New turn starting — if there are queued user messages, the oldest one
        // is now being processed by pi. Clear its queued flag.
        if let qi = messages.firstIndex(where: { $0.role == .user && $0.isQueued }) {
            messages[qi].isQueued = false
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
        heartbeatStallMs = nil
        stopStreamingWatchdog()
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
            // Clear partial once the final result arrives
            messages[i].meta?.partialResult = nil
        }
    }

    private func handleToolUpdate(id: String, partial: String) {
        if let i = messages.firstIndex(where: { $0.meta?.toolCallId == id }) {
            messages[i].meta?.partialResult = partial
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
