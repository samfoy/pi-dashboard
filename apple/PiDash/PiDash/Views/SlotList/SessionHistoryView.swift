import SwiftUI

// MARK: - SessionHistoryView

/// Sheet that lists and searches past pi agent sessions, letting the user resume one into a new slot.
struct SessionHistoryView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.appTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    var onSlotCreated: (String) -> Void

    // Search state
    @State private var searchText = ""
    @State private var searchResults: [SessionSearchResult] = []
    @State private var isSearching = false
    @State private var searchTask: Task<Void, Never>?

    // Fallback list state (shown when no search query)
    @State private var sessions: [SessionDTO] = []
    @State private var isLoading = false
    @State private var error: String?
    @State private var resumingId: String?

    private var showingSearchResults: Bool {
        !searchText.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Sessions")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done") { dismiss() }
                    }
                }
                .searchable(text: $searchText, prompt: "Search past sessions…")
                .onChange(of: searchText) { _, newValue in
                    debounceSearch(query: newValue)
                }
        }
        .task { await loadRecent() }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if showingSearchResults {
            searchContent
        } else {
            recentContent
        }
    }

    @ViewBuilder
    private var searchContent: some View {
        if isSearching && searchResults.isEmpty {
            ProgressView("Searching…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if searchResults.isEmpty {
            ContentUnavailableView.search(text: searchText)
        } else {
            List {
                ForEach(searchResults) { result in
                    SearchResultRow(
                        result: result,
                        isResuming: resumingId == result.id
                    ) {
                        Task { await resumeSearchResult(result) }
                    }
                }
            }
            .listStyle(.insetGrouped)
        }
    }

    @ViewBuilder
    private var recentContent: some View {
        if isLoading && sessions.isEmpty {
            ProgressView("Loading sessions…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error {
            ContentUnavailableView {
                Label("Could not load sessions", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error)
            } actions: {
                Button("Retry") { Task { await loadRecent() } }
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
                    SessionRow(
                        session: session,
                        isResuming: resumingId == session.key
                    ) {
                        Task { await resumeSession(session) }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { await loadRecent() }
        }
    }

    // MARK: - Actions

    private func loadRecent() async {
        isLoading = true
        error = nil
        do {
            sessions = try await appState.apiClient.fetchSessions()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func debounceSearch(query: String) {
        searchTask?.cancel()
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else {
            searchResults = []
            isSearching = false
            return
        }
        searchTask = Task {
            // 300ms debounce
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            isSearching = true
            do {
                let results = try await appState.apiClient.searchSessions(query: trimmed)
                guard !Task.isCancelled else { return }
                searchResults = results
            } catch {
                guard !Task.isCancelled else { return }
                searchResults = []
            }
            isSearching = false
        }
    }

    private func resumeSession(_ session: SessionDTO) async {
        guard resumingId == nil else { return }
        resumingId = session.key
        do {
            let newSlotKey = try await appState.apiClient.resumeSession(key: session.key)
            await appState.loadSlots()
            dismiss()
            onSlotCreated(newSlotKey)
        } catch {
            self.error = "Failed to resume: \(error.localizedDescription)"
        }
        resumingId = nil
    }

    private func resumeSearchResult(_ result: SessionSearchResult) async {
        guard resumingId == nil else { return }
        resumingId = result.id
        do {
            // Pass file path so the backend can find the session directly
            let newSlotKey = try await appState.apiClient.resumeSession(
                key: result.id,
                file: result.file
            )
            await appState.loadSlots()
            dismiss()
            onSlotCreated(newSlotKey)
        } catch {
            self.error = "Failed to resume: \(error.localizedDescription)"
        }
        resumingId = nil
    }
}

// MARK: - SessionRow (recent sessions)

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
                        .font(.subheadline)
                }
            }
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isResuming)
    }
}

// MARK: - SearchResultRow (FTS search results)

private struct SearchResultRow: View {
    let result: SessionSearchResult
    let isResuming: Bool
    let onResume: () -> Void

    var body: some View {
        Button(action: onResume) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(result.name)
                        .font(.headline)
                        .foregroundStyle(.primary)
                        .lineLimit(2)

                    if let summary = result.summary, !summary.isEmpty {
                        Text(summary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }

                    HStack(spacing: 6) {
                        if let project = result.projectSlug, !project.isEmpty {
                            Label(project, systemImage: "folder")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        if let date = result.startedDate {
                            Text(RelativeTimeFormatter.string(from: date))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        if result.messageCount > 0 {
                            Label("\(result.messageCount)", systemImage: "bubble.left.and.bubble.right")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        if let models = result.models, let first = models.first {
                            Text(first.components(separatedBy: "/").last ?? first)
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
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
                        .font(.subheadline)
                }
            }
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isResuming)
    }
}
