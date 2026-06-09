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
    var isStopping: Bool = false
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
    static let thinkingLevels = ModelInfo.allThinkingLevels

    private let apiClient: APIClient
    private weak var appState: AppState?
    private var streamingMessageId: UUID?
    /// Timestamp of last chunk/event observed — fed to the streaming watchdog.
    private var lastStreamEventAt: Date = .distantPast
    private var watchdogTask: Task<Void, Never>?
    /// Suppress overlapping background reloads.
    private var backgroundReloadInFlight = false
    /// Buffer of unapplied chunk text. Flushed to the streaming message at most
    /// once per frame (~33ms) — applying every chunk synchronously caused MainActor
    /// starvation under fast-streaming models, so chunks accumulated invisibly
    /// until chat_done freed the render loop.
    private var pendingChunkBuffer: String = ""
    private var chunkFlushTask: Task<Void, Never>?
    private static let chunkFlushIntervalNs: UInt64 = 33_000_000  // ~1 frame @ 30fps

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
            Log.error(error, context: "loadHistory(\(slotKey))", category: "ChatVM")
            self.error = error.errorDescription ?? error.localizedDescription
        } catch where isCancellation(error) {
            // Catch-all cancellation guard
        } catch {
            Log.error(error, context: "loadHistory(\(slotKey)) untyped", category: "ChatVM")
            self.error = "[\(type(of: error))] \(error.localizedDescription)"
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
        isStopping = true
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
            let piSettings = try? await apiClient.fetchPiSettings()
            // Exclude geographic-prefix duplicates (eu.*, global.*) — same model, different routing
            let filtered = allModels.filter { m in
                let id = m.id.lowercased()
                return !id.hasPrefix("eu.") && !id.hasPrefix("global.")
            }
            availableModels = ModelInfo.sorted(filtered, enabledModels: piSettings?.enabledModels ?? [])
            if let slotModel = slot.model {
                currentModel = availableModels.first { $0.fullId == slotModel }
            }
            if let currentModel, !currentModel.supportedThinkingLevels.contains(thinkingLevel) {
                thinkingLevel = Self.clampThinkingLevel(thinkingLevel, for: currentModel)
            }
        } catch {
            Log.error(error, context: "loadModels", category: "ChatVM")
        }
    }

    func loadSlashCommands() async {
        do {
            slashCommands = try await apiClient.fetchSlashCommands()
        } catch {
            Log.error(error, context: "loadSlashCommands", category: "ChatVM")
        }
    }

    func setModel(_ model: ModelInfo) async {
        do {
            try await apiClient.setModel(slot: slotKey, provider: model.provider, modelId: model.modelId)
            currentModel = model
            slot.model = model.fullId
            if !model.supportedThinkingLevels.contains(thinkingLevel) {
                let clamped = Self.clampThinkingLevel(thinkingLevel, for: model)
                try? await apiClient.setThinking(slot: slotKey, level: clamped)
                thinkingLevel = clamped
            }
            HapticManager.messageSent()
        } catch where isCancellation(error) {
            // ignore
        } catch {
            self.error = error.localizedDescription
        }
    }

    func setThinking(_ level: String) async {
        do {
            let clamped = currentModel.map { Self.clampThinkingLevel(level, for: $0) } ?? level
            try await apiClient.setThinking(slot: slotKey, level: clamped)
            thinkingLevel = clamped
            HapticManager.messageSent()
        } catch where isCancellation(error) {
            // ignore
        } catch {
            self.error = error.localizedDescription
        }
    }

    static func clampThinkingLevel(_ level: String, for model: ModelInfo) -> String {
        let available = model.supportedThinkingLevels
        if available.contains(level) { return level }
        guard let requested = thinkingLevels.firstIndex(of: level) else { return available.first ?? "off" }
        for i in requested..<thinkingLevels.count where available.contains(thinkingLevels[i]) {
            return thinkingLevels[i]
        }
        if requested > 0 {
            for i in stride(from: requested - 1, through: 0, by: -1) where available.contains(thinkingLevels[i]) {
                return thinkingLevels[i]
            }
        }
        return available.first ?? "off"
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
                    Log.debug("backgroundReload(\(reason)) → \(result.messages.count) msgs running=\(result.running)", category: "ChatVM")
                }
            } catch {
                // Quiet — best-effort backfill.
                Log.error(error, context: "backgroundReload", category: "ChatVM")
            }
        }
    }

    /// Replace `messages` with the server view, but preserve any in-flight
    /// streaming assistant placeholder so we don't wipe the cursor the user is
    /// watching. After reload, if the server reports the slot is idle and we
    /// still thought we were streaming, clear the streaming state.
    private func reconcileMessages(_ serverMessages: [ChatMessage], running: Bool) {
        // Drain any in-flight chunk buffer into our local placeholder before
        // diffing against the server view; otherwise buffered text would be
        // applied to the merged messages array after we've already overwritten it.
        flushPendingChunks()
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

    /// Drain the pending chunk buffer into the streaming message. Safe to call
    /// multiple times; cheap when the buffer is empty. Always called via the
    /// throttled flush task or synchronously before any event that replaces
    /// the streaming placeholder (chat_done, chat_message, tool_call, error).
    func flushPendingChunks() {
        chunkFlushTask?.cancel()
        chunkFlushTask = nil
        let pending = pendingChunkBuffer
        guard !pending.isEmpty else { return }
        pendingChunkBuffer = ""

        if let id = streamingMessageId,
           let i = messages.firstIndex(where: { $0.id == id }) {
            messages[i].content += pending
            return
        }
        // No streaming placeholder yet — create one. A queued user message,
        // if any, is now being processed.
        if let qi = messages.firstIndex(where: { $0.role == .user && $0.isQueued }) {
            messages[qi].isQueued = false
        }
        let newId = UUID()
        streamingMessageId = newId
        messages.append(ChatMessage(
            id: newId,
            slotKey: slotKey,
            role: .assistant,
            content: pending,
            isStreaming: true
        ))
    }

    private func scheduleChunkFlush() {
        guard chunkFlushTask == nil else { return }
        chunkFlushTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: ChatViewModel.chunkFlushIntervalNs)
            if Task.isCancelled { return }
            await MainActor.run {
                guard let self else { return }
                self.chunkFlushTask = nil
                self.flushPendingChunks()
            }
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
        // Any real chunk clears the heartbeat stall indicator. Guard the write
        // so we don't invalidate SwiftUI observers on every chunk when the
        // value is already nil.
        if heartbeatStallMs != nil { heartbeatStallMs = nil }
        lastStreamEventAt = Date()
        // isStreaming is the spinner / send-button gate — flip it on first chunk
        // so UI feedback is immediate; subsequent toggles are no-ops thanks to
        // @Observable's didSet equality check on identical values.
        if !isStreaming { isStreaming = true }
        if watchdogTask == nil { startStreamingWatchdog() }
        // Buffer the chunk and let the throttled flush apply it on the next
        // frame. This prevents chunk-rate body invalidations from pinning the
        // main thread and starving SwiftUI's render commit.
        pendingChunkBuffer += chunk
        scheduleChunkFlush()
    }

    private func finalizeStreaming() {
        // Drain any buffered chunks before tearing down the placeholder so
        // we don't lose the last few characters of the response.
        flushPendingChunks()
        if let id = streamingMessageId,
           let i = messages.firstIndex(where: { $0.id == id }) {
            messages[i].isStreaming = false
        }
        streamingMessageId = nil
        isStreaming = false
        isStopping = false
        heartbeatStallMs = nil
        stopStreamingWatchdog()
    }

    private func handleInboundMessage(role: String, content: String, ts: String?, meta: MessageMetaDTO?) {
        // If this message is going to replace or sit alongside a streaming
        // placeholder, drain buffered chunks first so they aren't applied to
        // a different (or no) placeholder afterwards.
        flushPendingChunks()
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
        // Drain buffered chunks into the streaming text bubble before closing it
        // — otherwise the tail end of the assistant's pre-tool-call text gets
        // discarded when streamingMessageId is cleared below.
        flushPendingChunks()
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
