import Foundation
import SwiftUI
import Combine

// MARK: - AppState

/// Central application state — owns the WebSocket connection and slot list.
@MainActor
@Observable
final class AppState {
    // Connection
    var serverConfig: ServerConfig
    var connectionState: ConnectionState = .disconnected

    // Notifications
    let notificationService = LocalNotificationService()

    // Slots
    var slots: [ChatSlot] = []
    var isLoadingSlots = false
    var slotsError: String?

    // Navigation
    var selectedSlotKey: String?
    /// Message ID to scroll to when opening a chat from search results.
    var selectedScrollTarget: UUID? = nil
    /// Set by deep-link handler (widget tap). SlotListView consumes + clears this.
    var pendingDeepLinkKey: String?

    // Pending first-message commands for newly created slots (e.g. from skills rail)
    var pendingCommands: [String: String] = [String: String]()

    func setPendingCommand(_ command: String, forSlot key: String) {
        pendingCommands[key] = command
    }

    func consumePendingCommand(forSlot key: String) -> String? {
        guard let cmd = pendingCommands[key] else { return nil }
        pendingCommands.removeValue(forKey: key)
        return cmd
    }

    // Dependencies
    let apiClient: APIClient
    let wsManager: WebSocketManager

    // Active chat view models that need WS events
    @ObservationIgnored private var chatViewModels: [String: ChatViewModel] = [:]

    private var eventTask: Task<Void, Never>?
    private var connectionObserver: AnyCancellable?

    init(serverConfig: ServerConfig = ServerConfig()) {
        self.serverConfig = serverConfig
        self.apiClient = APIClient(config: serverConfig)
        self.wsManager = WebSocketManager(config: serverConfig)
    }

    // MARK: - Lifecycle

    func start() {
        // Bridge wsManager's @Published connectionState into @Observable connectionState
        connectionObserver = wsManager.$connectionState.sink { [weak self] state in
            self?.connectionState = state
        }
        wsManager.connect()
        eventTask = Task { [weak self] in
            guard let self else { return }
            for await event in self.wsManager.events {
                await self.handle(event: event)
            }
        }
        Task { await loadSlots() }
        Task { await loadInitialNotifications() }
        Task { await notificationService.requestPermission() }
        // Wire notification tap → navigate to chat
        notificationService.onNotificationTap = { [weak self] slotKey in
            self?.pendingDeepLinkKey = slotKey
        }
    }

    func stop() {
        eventTask?.cancel()
        connectionObserver?.cancel()
        wsManager.disconnect()
    }

    // MARK: - Slots

    func loadSlots() async {
        isLoadingSlots = true
        slotsError = nil
        do {
            slots = try await apiClient.fetchSlots()
        } catch {
            slotsError = error.localizedDescription
        }
        isLoadingSlots = false
    }

    func createSlot(title: String? = nil, cwd cwdOverride: String? = nil) async -> ChatSlot? {
        let resolved: String?
        if let cwdOverride {
            resolved = cwdOverride
        } else {
            resolved = serverConfig.defaultCwd.isEmpty ? nil : serverConfig.defaultCwd
        }
        do {
            let slot = try await apiClient.createSlot(title: title, cwd: resolved)
            // Only insert if WS hasn't already added it
            if !slots.contains(where: { $0.key == slot.key }) {
                slots.insert(slot, at: 0)
            }
            return slot
        } catch {
            slotsError = error.localizedDescription
            return nil
        }
    }

    func deleteSlot(key: String) async {
        do {
            try await apiClient.deleteSlot(key: key)
            slots.removeAll { $0.key == key }
        } catch {
            slotsError = error.localizedDescription
        }
    }

    func renameSlot(key: String, title: String) async {
        do {
            try await apiClient.renameSlot(key: key, title: title)
            if let i = slots.firstIndex(where: { $0.key == key }) {
                slots[i].title = title
            }
        } catch {
            slotsError = error.localizedDescription
        }
    }

    // MARK: - Notifications

    func loadInitialNotifications() async {
        do {
            let notifs = try await apiClient.fetchNotifications()
            // Only mark input_needed for very recent unacked notifications (< 5 min)
            let cutoff = Date().addingTimeInterval(-300)
            for notif in notifs where !(notif.acked) {
                if let slotKey = notif.slot,
                   let ts = isoDateParse(notif.ts),
                   ts > cutoff,
                   let i = slots.firstIndex(where: { $0.key == slotKey }) {
                    slots[i].inputNeeded = true
                }
            }
        } catch {
            print("[AppState] Failed to load notifications: \(error)")
        }
    }

    private func isoDateParse(_ string: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: string) ?? ISO8601DateFormatter().date(from: string)
    }

    /// Call when a slot is opened to clear its notification badge.
    func clearNotification(forSlot key: String) {
        if let i = slots.firstIndex(where: { $0.key == key }) {
            slots[i].inputNeeded = false
        }
    }

    // MARK: - Config update

    func updateServerConfig(baseURL: String) {
        var newConfig = serverConfig
        newConfig.update(baseURL: baseURL)
        serverConfig = newConfig
        wsManager.updateConfig(newConfig)
        Task { await apiClient.updateConfig(newConfig) }
        Task { await loadSlots() }
    }

    func updateDefaultCwd(_ cwd: String) {
        serverConfig.update(cwd: cwd)
    }

    // MARK: - Chat ViewModel Registration

    func registerChatViewModel(_ vm: ChatViewModel, for slotKey: String) {
        chatViewModels[slotKey] = vm
        notificationService.activeSlotKey = slotKey
        notificationService.clearNotifications(forSlot: slotKey)
        print("[AppState] Registered VM for slot \(slotKey) (total: \(chatViewModels.count))")
    }

    func unregisterChatViewModel(for slotKey: String) {
        chatViewModels.removeValue(forKey: slotKey)
        notificationService.activeSlotKey = chatViewModels.keys.first  // nil if none left
        print("[AppState] Unregistered VM for slot \(slotKey) (total: \(chatViewModels.count))")
    }

    // MARK: - WS Event Handling

    private func handle(event: ServerEvent) async {
        switch event {
        case .slots(let updated):
            mergeSlots(updated)
        case .slotTitle(let key, let title):
            if let i = slots.firstIndex(where: { $0.key == key }) {
                slots[i].title = title
            }
        case .chatDone(let slotKey):
            if let i = slots.firstIndex(where: { $0.key == slotKey }) {
                slots[i].isStreaming = false
                slots[i].updatedAt = Date()
                notificationService.notifyChatDone(slotKey: slotKey, title: slots[i].title)
            }
        case .chatChunk(let slotKey, _, _):
            if let i = slots.firstIndex(where: { $0.key == slotKey }) {
                slots[i].isStreaming = true
                slots[i].updatedAt = Date()
            }
        case .chatMessage(let slotKey, _, let content, _, _):
            if let i = slots.firstIndex(where: { $0.key == slotKey }) {
                slots[i].updatedAt = Date()
                slots[i].lastMessage = String(content.prefix(100))
            }
        case .toolCall(let slotKey, _, _, _):
            if let i = slots.firstIndex(where: { $0.key == slotKey }) {
                slots[i].updatedAt = Date()
            }
        case .contextUsage(let slotKey, _, let percent):
            if let i = slots.firstIndex(where: { $0.key == slotKey }) {
                // Server sends percent as 0-100, normalize to 0.0-1.0
                slots[i].contextPercent = (percent ?? 0) / 100.0
            }
        case .notification(let kind, let title, let body, let slotKey, _) where kind == "input_needed":
            if let slotKey,
               let i = slots.firstIndex(where: { $0.key == slotKey }) {
                slots[i].inputNeeded = true
                slots[i].updatedAt = Date()
                notificationService.notifyInputNeeded(slotKey: slotKey, title: slots[i].title, body: body)
            }
        default:
            break
        }

        // Forward to registered chat view models
        if !chatViewModels.isEmpty {
            for (key, vm) in chatViewModels {
                print("[AppState] Forwarding event to VM for slot \(key)")
                vm.handle(event: event)
            }
        }
    }

    private func mergeSlots(_ updated: [ChatSlot]) {
        var map: [String: ChatSlot] = Dictionary(uniqueKeysWithValues: slots.map { ($0.key, $0) })
        for var s in updated {
            if let existing = map[s.key] {
                // Preserve local state that the server doesn't track
                s.isStreaming = existing.isStreaming
                s.contextPercent = existing.contextPercent
                s.inputNeeded = existing.inputNeeded
                // Keep local updatedAt if it's more recent (from WS events)
                if existing.updatedAt > s.updatedAt {
                    s.updatedAt = existing.updatedAt
                }
                if let msg = existing.lastMessage {
                    s.lastMessage = msg
                }
            }
            map[s.key] = s
        }
        slots = updated.map { map[$0.key] ?? $0 }
    }
}
