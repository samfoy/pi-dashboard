import Foundation
import Observation

// MARK: - WorkflowsViewModel

@MainActor
@Observable
final class WorkflowsViewModel {

    // MARK: State

    var runs: [WorkflowRun] = []
    var scripts: [WorkflowScript] = []
    var isLoading = false
    var error: String?

    // MARK: Private

    private let apiClient: APIClient
    private var pollTask: Task<Void, Never>?

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    // MARK: Lifecycle

    func start() {
        Task { await load() }
        startPolling()
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
    }

    // MARK: Loading

    func load() async {
        isLoading = runs.isEmpty
        error = nil
        do {
            async let runsResult = apiClient.fetchWorkflowRuns()
            async let scriptsResult = apiClient.fetchWorkflowScripts()
            let (newRuns, newScripts) = try await (runsResult, scriptsResult)
            runs = newRuns
            scripts = newScripts
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func deleteRun(_ run: WorkflowRun) async {
        do {
            try await apiClient.deleteWorkflowRun(runId: run.runId)
            runs.removeAll { $0.runId == run.runId }
        } catch {
            self.error = "Delete failed: \(error.localizedDescription)"
        }
    }

    // MARK: Polling

    /// Poll every 3s while any active runs exist; back off to 15s when all terminal.
    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task {
            while !Task.isCancelled {
                let interval: UInt64 = runs.contains(where: { $0.state.isActive }) ? 3 : 15
                try? await Task.sleep(nanoseconds: interval * 1_000_000_000)
                if Task.isCancelled { break }
                await load()
            }
        }
    }
}
