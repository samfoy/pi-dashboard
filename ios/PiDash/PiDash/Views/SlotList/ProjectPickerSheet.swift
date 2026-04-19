import SwiftUI

// MARK: - ProjectPickerSheet

/// Sheet for picking a working directory when creating or switching the cwd of a chat slot.
/// Sections: direct path input, Home, Recent Projects, Pinned Projects, Browse.
struct ProjectPickerSheet: View {
    let slots: [ChatSlot]
    let apiClient: APIClient
    let onSelect: (String) -> Void

    @Environment(\.dismiss) private var dismiss

    // Pinned projects — stored in App Group UserDefaults
    @State private var pinnedProjects: [String] = []

    // Direct-path field
    @State private var pathText: String = ""

    // Browse state
    @State private var showBrowse = false

    // Keyed from App Group UserDefaults
    private static let pinnedKey = "projectPicker.pinnedProjects"

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

                // Pinned projects
                if !pinnedProjects.isEmpty {
                    Section("Pinned") {
                        ForEach(pinnedProjects, id: \.self) { path in
                            ProjectRow(path: path, icon: "star.fill", iconColor: .yellow) {
                                pick(path)
                            }
                        }
                        .onDelete { offsets in
                            pinnedProjects.remove(atOffsets: offsets)
                            savePins()
                        }
                    }
                }

                // Recent projects from existing slots
                let recents = recentProjects
                if !recents.isEmpty {
                    Section("Recent") {
                        ForEach(recents, id: \.self) { path in
                            ProjectRow(path: path, icon: "clock", iconColor: .secondary) {
                                pick(path)
                            }
                            .swipeActions(edge: .leading) {
                                Button {
                                    pin(path)
                                } label: {
                                    Label("Pin", systemImage: "star")
                                }
                                .tint(.yellow)
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
        .onAppear { loadPins() }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    // MARK: - Helpers

    private var recentProjects: [String] {
        let seen = Set(pinnedProjects)
        var unique: [String] = []
        for slot in slots.sorted(by: { $0.updatedAt > $1.updatedAt }) {
            guard let cwd = slot.cwd, !cwd.isEmpty, !seen.contains(cwd),
                  !unique.contains(cwd) else { continue }
            unique.append(cwd)
        }
        return unique
    }

    private func pick(_ path: String) {
        onSelect(path)
        dismiss()
    }

    private func submitPath() {
        let trimmed = pathText.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        pick(trimmed)
    }

    private func pin(_ path: String) {
        guard !pinnedProjects.contains(path) else { return }
        pinnedProjects.insert(path, at: 0)
        savePins()
    }

    private func loadPins() {
        let defaults = ServerConfig.sharedDefaults
        pinnedProjects = defaults.stringArray(forKey: Self.pinnedKey) ?? []
    }

    private func savePins() {
        ServerConfig.sharedDefaults.set(pinnedProjects, forKey: Self.pinnedKey)
    }
}

// MARK: - ProjectRow

private struct ProjectRow: View {
    let path: String
    let icon: String
    let iconColor: Color
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
