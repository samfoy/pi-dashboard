import SwiftUI

// MARK: - SessionHistoryView

/// Sheet that lists recent pi agent sessions and lets the user resume one into a new slot.
struct SessionHistoryView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    var onSlotCreated: (String) -> Void

    @State private var sessions: [SessionDTO] = []
    @State private var isLoading = false
    @State private var error: String?
    @State private var resumingKey: String?

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Session History")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done") { dismiss() }
                    }
                }
        }
        .task { await load() }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if isLoading && sessions.isEmpty {
            ProgressView("Loading sessions…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error {
            ContentUnavailableView {
                Label("Could not load sessions", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error)
            } actions: {
                Button("Retry") { Task { await load() } }
            }
        } else if sessions.isEmpty {
            ContentUnavailableView {
                Label("No sessions found", systemImage: "clock.arrow.circlepath")
            } description: {
                Text("Past pi agent sessions will appear here.")
            }
        } else {
            List {
                ForEach(sessions) { session in
                    SessionRow(session: session, isResuming: resumingKey == session.key) {
                        Task { await resume(session: session) }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { await load() }
        }
    }

    // MARK: - Actions

    private func load() async {
        isLoading = true
        error = nil
        do {
            sessions = try await appState.apiClient.fetchSessions()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func resume(session: SessionDTO) async {
        guard resumingKey == nil else { return }
        resumingKey = session.key
        do {
            let newSlotKey = try await appState.apiClient.resumeSession(key: session.key)
            // Reload slots so the new one appears
            await appState.loadSlots()
            dismiss()
            onSlotCreated(newSlotKey)
        } catch {
            self.error = "Failed to resume: \(error.localizedDescription)"
        }
        resumingKey = nil
    }
}

// MARK: - SessionRow

private struct SessionRow: View {
    let session: SessionDTO
    let isResuming: Bool
    let onResume: () -> Void

    var body: some View {
        Button(action: onResume) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(session.title)
                        .font(.headline)
                        .foregroundStyle(.primary)
                        .lineLimit(2)

                    HStack(spacing: 6) {
                        if let project = session.project, !project.isEmpty {
                            Label(project, systemImage: "folder")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        if let date = session.modifiedDate {
                            Text(RelativeTimeFormatter.string(from: date))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Spacer()

                if isResuming {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: "arrow.trianglehead.clockwise")
                        .foregroundStyle(.secondary)
                        .font(.system(size: 14))
                }
            }
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isResuming)
    }
}
