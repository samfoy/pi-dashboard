import SwiftUI

// MARK: - Recent Commands Store

@Observable
final class RecentCommandsStore {
    private(set) var recentNames: [String] = []

    private let key = "command_palette_recents"
    private let maxCount = 10

    init() {
        recentNames = UserDefaults.standard.stringArray(forKey: key) ?? []
    }

    func record(_ name: String) {
        var names = recentNames.filter { $0 != name }
        names.insert(name, at: 0)
        if names.count > maxCount { names = Array(names.prefix(maxCount)) }
        recentNames = names
        UserDefaults.standard.set(names, forKey: key)
    }
}

// MARK: - Command Palette Sheet

struct CommandPaletteSheet: View {
    let commands: [SlashCommand]
    let onSelect: (SlashCommand) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""
    @State private var recents = RecentCommandsStore()

    private let desktopOnly = Set(["lsp", "bemol", "reload", "mcp", "lsp-config", "lsp-lombok"])

    private var eligible: [SlashCommand] {
        commands.filter { !desktopOnly.contains($0.name) }
    }

    private var recentCommands: [SlashCommand] {
        recents.recentNames.compactMap { name in eligible.first { $0.name == name } }
    }

    private var searchResults: [SlashCommand] {
        guard !searchText.isEmpty else { return [] }
        let q = searchText.lowercased()
        return eligible.filter {
            $0.name.lowercased().contains(q) ||
            $0.description.lowercased().contains(q) ||
            $0.displayName.lowercased().contains(q)
        }
    }

    private var groupedEligible: [(CommandCategory, [SlashCommand])] {
        CommandCategory.allCases.compactMap { category in
            let cmds = eligible.filter { $0.category == category }
            return cmds.isEmpty ? nil : (category, cmds)
        }
    }

    var body: some View {
        NavigationStack {
            commandList
                .searchable(text: $searchText, prompt: "Search commands")
                .navigationTitle("Commands")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done") { dismiss() }
                    }
                }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    @ViewBuilder
    private var commandList: some View {
        List {
            if !searchText.isEmpty {
                if searchResults.isEmpty {
                    ContentUnavailableView(
                        "No Results",
                        systemImage: "magnifyingglass",
                        description: Text("Try a different search term")
                    )
                } else {
                    Section {
                        ForEach(searchResults) { cmd in commandRow(cmd) }
                    }
                }
            } else {
                if !recentCommands.isEmpty {
                    Section("Recent") {
                        ForEach(recentCommands) { cmd in commandRow(cmd) }
                    }
                }
                ForEach(groupedEligible, id: \.0) { category, cmds in
                    Section(category.rawValue) {
                        ForEach(cmds) { cmd in commandRow(cmd) }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func commandRow(_ cmd: SlashCommand) -> some View {
        Button {
            recents.record(cmd.name)
            dismiss()
            onSelect(cmd)
        } label: {
            HStack(spacing: 12) {
                Text(cmd.icon)
                    .font(.title3)
                    .frame(width: 32, alignment: .center)
                VStack(alignment: .leading, spacing: 2) {
                    Text("/\(cmd.name)")
                        .font(.body.monospaced())
                        .foregroundStyle(.primary)
                    if !cmd.description.isEmpty {
                        Text(cmd.description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
