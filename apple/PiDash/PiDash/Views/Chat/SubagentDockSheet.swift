import SwiftUI

// MARK: - SubagentDockSheet

/// Live dock of subagents for the current slot. Polls `/api/subagents/status`
/// every 3 seconds and lets the user drill into each agent's tail log.
struct SubagentDockSheet: View {
    let slotKey: String
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appTheme) private var theme

    @State private var agents: [SubagentInfoDTO] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var pollTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && agents.isEmpty {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error, agents.isEmpty {
                    ContentUnavailableView {
                        Label("Couldn't load subagents", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    }
                } else if agents.isEmpty {
                    ContentUnavailableView(
                        "No subagents running",
                        systemImage: "person.2.crop.square.stack",
                        description: Text("No subagents are running for this slot.")
                    )
                } else {
                    list
                }
            }
            .navigationTitle("Subagents")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .onAppear { startPolling() }
        .onDisappear { stopPolling() }
    }

    private var list: some View {
        List(agents) { agent in
            NavigationLink {
                SubagentLogView(agent: agent)
            } label: {
                row(for: agent)
            }
        }
        .listStyle(.plain)
        .refreshable { await refresh() }
    }

    private func row(for agent: SubagentInfoDTO) -> some View {
        HStack(alignment: .top, spacing: 10) {
            statusIcon(for: agent)
                .frame(width: 22, height: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(agent.task?.isEmpty == false ? agent.task! : agent.id)
                    .font(.subheadline)
                    .lineLimit(3)
                Text(agent.id)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func statusIcon(for agent: SubagentInfoDTO) -> some View {
        let done = agent.done ?? false
        let hasError = (agent.error?.isEmpty == false)
        if !done {
            ProgressView().controlSize(.small)
        } else if hasError {
            Image(systemName: "xmark.circle.fill")
                .foregroundStyle(theme.error)
        } else {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
        }
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task {
            await refresh()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                if Task.isCancelled { break }
                await refresh()
            }
        }
    }

    private func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    private func refresh() async {
        do {
            let fresh = try await appState.apiClient.fetchSubagents(slot: slotKey)
            agents = fresh
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

// MARK: - SubagentLogView

/// Live tail of a single subagent's log. Polls every 2 seconds; auto-scrolls
/// to the bottom when new content arrives.
struct SubagentLogView: View {
    let agent: SubagentInfoDTO
    @Environment(AppState.self) private var appState
    @Environment(\.appTheme) private var theme

    @State private var logText: String = ""
    @State private var isLoading = true
    @State private var error: String?
    @State private var pollTask: Task<Void, Never>?
    @State private var bottomAnchor = UUID()

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if isLoading && logText.isEmpty {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .padding()
                    } else if let error, logText.isEmpty {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(theme.error)
                            .padding()
                    } else if logText.isEmpty {
                        Text("(no output yet)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding()
                    } else {
                        Text(logText)
                            .font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                    }
                    // Anchor — changes whenever logText changes, triggering scrollTo
                    Color.clear
                        .frame(height: 1)
                        .id(bottomAnchor)
                }
            }
            .onChange(of: bottomAnchor) { _, newId in
                withAnimation(.easeOut(duration: 0.15)) {
                    proxy.scrollTo(newId, anchor: .bottom)
                }
            }
        }
        .navigationTitle(agent.task?.isEmpty == false ? shortTask : agent.id)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await refresh() }
        .onAppear { startPolling() }
        .onDisappear { stopPolling() }
    }

    private var shortTask: String {
        guard let task = agent.task else { return agent.id }
        if task.count <= 40 { return task }
        return String(task.prefix(40)) + "\u{2026}"
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task {
            await refresh()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                if Task.isCancelled { break }
                await refresh()
            }
        }
    }

    private func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    private func refresh() async {
        do {
            let fresh = try await appState.apiClient.fetchSubagentLog(id: agent.id)
            if fresh != logText {
                logText = fresh
                bottomAnchor = UUID()
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
