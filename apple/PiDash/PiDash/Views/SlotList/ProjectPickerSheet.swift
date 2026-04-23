import SwiftUI

// MARK: - DirFrequencyStore

/// Tracks how often each working directory is used for sessions.
/// Persisted to UserDefaults (App Group). Sorted by frequency then recency.
@Observable
final class DirFrequencyStore {
    struct Entry: Identifiable {
        let path: String
        var count: Int
        var lastUsed: Date
        var id: String { path }
    }

    private(set) var entries: [Entry] = []

    private static let storeKey = "dirFrequency.store"
    private let defaults: UserDefaults

    init(defaults: UserDefaults = ServerConfig.sharedDefaults) {
        self.defaults = defaults
        load()
        migratePinnedDirs()
    }

    /// Record a directory being used (session created or cwd changed).
    func record(_ path: String) {
        if let i = entries.firstIndex(where: { $0.path == path }) {
            entries[i].count += 1
            entries[i].lastUsed = Date()
        } else {
            entries.append(Entry(path: path, count: 1, lastUsed: Date()))
        }
        sort()
        save()
    }

    /// Remove a directory from tracking.
    func remove(_ path: String) {
        entries.removeAll { $0.path == path }
        save()
    }

    /// Sorted by frequency (descending), then recency.
    private func sort() {
        entries.sort { a, b in
            if a.count != b.count { return a.count > b.count }
            return a.lastUsed > b.lastUsed
        }
    }

    // MARK: - Persistence

    private struct Stored: Codable {
        let path: String
        let count: Int
        let lastUsed: Double // timeIntervalSince1970
    }

    private func load() {
        guard let data = defaults.data(forKey: Self.storeKey),
              let stored = try? JSONDecoder().decode([Stored].self, from: data) else { return }
        entries = stored.map {
            Entry(path: $0.path, count: $0.count, lastUsed: Date(timeIntervalSince1970: $0.lastUsed))
        }
        sort()
    }

    private func save() {
        let stored = entries.map {
            Stored(path: $0.path, count: $0.count, lastUsed: $0.lastUsed.timeIntervalSince1970)
        }
        if let data = try? JSONEncoder().encode(stored) {
            defaults.set(data, forKey: Self.storeKey)
        }
    }

    /// One-time migration from old pinned projects.
    private static let migratedKey = "dirFrequency.migratedPinned"
    private static let pinnedKey = "projectPicker.pinnedProjects"

    private func migratePinnedDirs() {
        guard !defaults.bool(forKey: Self.migratedKey) else { return }
        let pinned = defaults.stringArray(forKey: Self.pinnedKey) ?? []
        let existingPaths = Set(entries.map(\.path))
        for path in pinned where !existingPaths.contains(path) {
            entries.append(Entry(path: path, count: 1, lastUsed: Date()))
        }
        sort()
        save()
        defaults.set(true, forKey: Self.migratedKey)
    }
}

// MARK: - ProjectPickerSheet

/// Sheet for picking a working directory when creating or switching the cwd of a chat slot.
/// Sections: direct path input, Frequent Projects, Recent (from active slots), Browse.
struct ProjectPickerSheet: View {
    let slots: [ChatSlot]
    let apiClient: APIClient
    let onSelect: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var dirFreq = DirFrequencyStore()

    // Direct-path field
    @State private var pathText: String = ""

    // Browse state
    @State private var showBrowse = false

    var body: some View {
        NavigationStack {
            List {
                // Direct path field
                Section {
                    HStack {
                        Image(systemName: "folder.badge.questionmark")
                            .foregroundStyle(.secondary)
                        TextField("Type or paste a path…", text: $pathText)
                            .autocorrectionDisabled()
                            .autocapitalization(.none)
                            .onSubmit { submitPath() }
                        if !pathText.isEmpty {
                            Button("Open") { submitPath() }
                                .font(.subheadline.bold())
                        }
                    }
                }

                // Quick options
                Section {
                    Button {
                        pick("~")
                    } label: {
                        Label("Home (~)", systemImage: "house")
                    }
                    .foregroundStyle(.primary)

                    Button {
                        showBrowse = true
                    } label: {
                        Label("Browse…", systemImage: "folder.badge.magnifyingglass")
                    }
                    .foregroundStyle(.primary)
                }

                // Frequent directories
                if !dirFreq.entries.isEmpty {
                    Section("Frequent") {
                        ForEach(dirFreq.entries.prefix(15)) { entry in
                            ProjectRow(
                                path: entry.path,
                                icon: "flame.fill",
                                iconColor: .orange,
                                badge: "\(entry.count)"
                            ) {
                                pick(entry.path)
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button(role: .destructive) {
                                    dirFreq.remove(entry.path)
                                } label: {
                                    Label("Remove", systemImage: "trash")
                                }
                            }
                        }
                    }
                }

                // Recent projects from active slots (not already in frequent)
                let recents = recentProjects
                if !recents.isEmpty {
                    Section("From Active Sessions") {
                        ForEach(recents, id: \.self) { path in
                            ProjectRow(
                                path: path,
                                icon: "clock",
                                iconColor: .secondary
                            ) {
                                pick(path)
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Choose Project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .navigationDestination(isPresented: $showBrowse) {
                BrowseView(apiClient: apiClient, onSelect: { path in
                    pick(path)
                })
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    // MARK: - Helpers

    private var recentProjects: [String] {
        let frequentPaths = Set(dirFreq.entries.map(\.path))
        var unique: [String] = []
        for slot in slots.sorted(by: { $0.updatedAt > $1.updatedAt }) {
            guard let cwd = slot.cwd, !cwd.isEmpty,
                  !frequentPaths.contains(cwd),
                  !unique.contains(cwd) else { continue }
            unique.append(cwd)
        }
        return unique
    }

    private func pick(_ path: String) {
        dirFreq.record(path)
        onSelect(path)
        dismiss()
    }

    private func submitPath() {
        let trimmed = pathText.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        pick(trimmed)
    }
}

// MARK: - ProjectRow

private struct ProjectRow: View {
    let path: String
    let icon: String
    let iconColor: Color
    var badge: String? = nil
    let action: () -> Void

    private var displayName: String {
        (path as NSString).lastPathComponent.isEmpty ? path : (path as NSString).lastPathComponent
    }

    var body: some View {
        Button(action: action) {
            HStack {
                Image(systemName: icon)
                    .foregroundStyle(iconColor)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(displayName)
                        .font(.body)
                        .foregroundStyle(.primary)
                    Text(path)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                if let badge {
                    Text(badge)
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.secondary.opacity(0.12))
                        .clipShape(Capsule())
                }
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
    }
}

// MARK: - BrowseView

/// Directory navigation view used inside the ProjectPickerSheet navigation stack.
struct BrowseView: View {
    let apiClient: APIClient
    let onSelect: (String) -> Void
    @Environment(\.appTheme) private var theme

    @State private var currentPath: String? = nil
    @State private var response: BrowseResponse? = nil
    @State private var isLoading = false
    @State private var errorMessage: String? = nil

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = errorMessage {
                ContentUnavailableView(
                    "Can't Load Directory",
                    systemImage: "exclamationmark.triangle",
                    description: Text(err)
                )
            } else if let resp = response {
                browseList(resp)
            }
        }
        .navigationTitle((currentPath as NSString?)?.lastPathComponent ?? "~")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: currentPath) {
            await load()
        }
    }

    @ViewBuilder
    private func browseList(_ resp: BrowseResponse) -> some View {
        let last = (resp.path as NSString).lastPathComponent
        let folderName = last.isEmpty ? resp.path : last
        List {
            Section {
                Button {
                    onSelect(resp.path)
                } label: {
                    Label("Use \"\(folderName)\"",
                          systemImage: "checkmark.circle.fill")
                        .font(.body.bold())
                        .foregroundStyle(theme.accent)
                }
            }
            if resp.entries.isEmpty {
                Section {
                    Text("No subdirectories")
                        .foregroundStyle(.secondary)
                }
            } else {
                Section("Subdirectories") {
                    ForEach(resp.entries.filter(\.isDir)) { entry in
                        Button {
                            navigate(to: entry.path)
                        } label: {
                            HStack {
                                Image(systemName: "folder.fill")
                                    .foregroundStyle(.yellow)
                                Text(entry.name)
                                    .foregroundStyle(.primary)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption)
                                    .foregroundStyle(.tertiary)
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func navigate(to path: String) {
        currentPath = path
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            response = try await apiClient.fetchBrowse(path: currentPath)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}
