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

    // Slots
    var slots: [ChatSlot] = []
    var isLoadingSlots = false
    var slotsError: String?

    // Navigation
    var selectedSlotKey: String?

    // Dependencies
    let apiClient: APIClient
    let wsManager: WebSocketManager

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

    func createSlot(title: String? = nil) async -> ChatSlot? {
        do {
            let slot = try await apiClient.createSlot(title: title)
            slots.insert(slot, at: 0)
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

    // MARK: - Config update

    func updateServerConfig(baseURL: String) {
        var newConfig = serverConfig
        newConfig.update(baseURL: baseURL)
        serverConfig = newConfig
        wsManager.updateConfig(newConfig)
        Task { await apiClient.updateConfig(newConfig) }
        Task { await loadSlots() }
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
            }
        case .chatChunk(let slotKey, _, _):
            if let i = slots.firstIndex(where: { $0.key == slotKey }) {
                slots[i].isStreaming = true
            }
        case .contextUsage(let slotKey, _, let percent):
            if let i = slots.firstIndex(where: { $0.key == slotKey }) {
                slots[i].contextPercent = percent
            }
        default:
            break
        }
    }

    private func mergeSlots(_ updated: [ChatSlot]) {
        var map: [String: ChatSlot] = Dictionary(uniqueKeysWithValues: slots.map { ($0.key, $0) })
        for var s in updated {
            if let existing = map[s.key] {
                s.isStreaming = existing.isStreaming
                s.contextPercent = existing.contextPercent
            }
            map[s.key] = s
        }
        slots = updated.map { map[$0.key] ?? $0 }
    }
}
