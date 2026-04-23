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

// MARK: - Palette Mode

private enum PaletteMode {
    case root
    case modelPicker
    case thinkingPicker
    case slashCommands
}

// MARK: - Command Palette Sheet

struct CommandPaletteSheet: View {
    let commands: [SlashCommand]
    let onSelect: (SlashCommand) -> Void

    // Optional: pass these for model/thinking/rename/tags support
    var viewModel: ChatViewModel?
    var onTagsTapped: (() -> Void)?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appTheme) private var theme
    @State private var mode: PaletteMode = .root
    @State private var searchText = ""
    @State private var recents = RecentCommandsStore()
    @State private var showRename = false
    @State private var renameText = ""

    private let desktopOnly = Set(["/lsp", "/bemol", "/mcp", "/lsp-config", "/lsp-lombok"])

    var body: some View {
        NavigationStack {
            Group {
                switch mode {
                case .root:
                    rootView
                case .modelPicker:
                    modelPickerView
                case .thinkingPicker:
                    thinkingPickerView
                case .slashCommands:
                    slashCommandsView
                }
            }
            .searchable(text: $searchText, prompt: mode == .modelPicker ? "Search models" : mode == .slashCommands ? "Search commands" : "Search actions")
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if mode != .root {
                        Button {
                            withAnimation { mode = .root; searchText = "" }
                        } label: {
                            Image(systemName: "chevron.left")
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .alert("Rename Chat", isPresented: $showRename) {
            TextField("Chat name", text: $renameText)
            Button("Cancel", role: .cancel) {}
            Button("Save") {
                let trimmed = renameText.trimmingCharacters(in: .whitespaces)
                guard !trimmed.isEmpty else { return }
                Task { await viewModel?.rename(title: trimmed) }
            }
        }
    }

    private var navigationTitle: String {
        switch mode {
        case .root: return "Actions"
        case .modelPicker: return "Model"
        case .thinkingPicker: return "Thinking"
        case .slashCommands: return "Commands"
        }
    }

    // MARK: - Root View

    @ViewBuilder
    private var rootView: some View {
        let q = searchText.lowercased()
        let filtering = !searchText.isEmpty

        List {
            // Navigate section
            if let vm = viewModel {
                let items: [(String, String, String, () -> Void)] = [
                    ("cpu", "Model", vm.currentModel?.label ?? "Default", { withAnimation { mode = .modelPicker; searchText = "" } }),
                    ("brain", "Thinking", vm.thinkingLevel.capitalized, { withAnimation { mode = .thinkingPicker; searchText = "" } }),
                ]
                let filtered = filtering ? items.filter { $0.1.lowercased().contains(q) || $0.2.lowercased().contains(q) } : items
                if !filtered.isEmpty {
                    Section("Navigate") {
                        ForEach(filtered, id: \.1) { icon, label, detail, action in
                            Button(action: action) {
                                HStack {
                                    Image(systemName: icon)
                                        .frame(width: 28)
                                        .foregroundStyle(theme.accent)
                                    Text(label)
                                        .foregroundStyle(.primary)
                                    Spacer()
                                    Text(detail)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                    Image(systemName: "chevron.right")
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            // Session actions
            if let vm = viewModel {
                let sessionItems: [(String, String, String, () -> Void)] = [
                    ("pencil", "Rename", vm.slot.title, {
                        renameText = vm.slot.title
                        showRename = true
                    }),
                    ("tag", "Tags", vm.slot.tags.isEmpty ? "None" : vm.slot.tags.joined(separator: ", "), {
                        dismiss()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                            onTagsTapped?()
                        }
                    }),
                ]
                let filtered = filtering ? sessionItems.filter { $0.1.lowercased().contains(q) || $0.2.lowercased().contains(q) } : sessionItems
                if !filtered.isEmpty {
                    Section("Session") {
                        ForEach(filtered, id: \.1) { icon, label, detail, action in
                            Button(action: action) {
                                HStack {
                                    Image(systemName: icon)
                                        .frame(width: 28)
                                        .foregroundStyle(theme.accent)
                                    Text(label)
                                        .foregroundStyle(.primary)
                                    Spacer()
                                    Text(detail)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            // Slash commands — show top 5 recent + "All Commands" row
            if !filtering {
                let recentCmds = recents.recentNames.prefix(5).compactMap { name in
                    commands.first { $0.name == name && !desktopOnly.contains($0.name) }
                }
                Section("Commands") {
                    if !recentCmds.isEmpty {
                        ForEach(recentCmds) { cmd in commandRow(cmd) }
                    }
                    Button {
                        withAnimation { mode = .slashCommands; searchText = "" }
                    } label: {
                        HStack {
                            Image(systemName: "terminal")
                                .frame(width: 28)
                                .foregroundStyle(theme.accent)
                            Text("All Commands")
                                .foregroundStyle(.primary)
                            Spacer()
                            Text("\(commands.filter { !desktopOnly.contains($0.name) }.count)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Image(systemName: "chevron.right")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }
                    .buttonStyle(.plain)
                }
            } else {
                // When filtering, search across commands too
                let eligible = commands.filter { !desktopOnly.contains($0.name) }
                let matchingCmds = eligible.filter {
                    $0.name.lowercased().contains(q) ||
                    $0.description.lowercased().contains(q) ||
                    $0.displayName.lowercased().contains(q)
                }
                if !matchingCmds.isEmpty {
                    Section("Commands") {
                        ForEach(matchingCmds) { cmd in commandRow(cmd) }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    // MARK: - Model Picker

    @ViewBuilder
    private var modelPickerView: some View {
        if let vm = viewModel {
            let q = searchText.lowercased()
            let models = searchText.isEmpty ? vm.availableModels : vm.availableModels.filter {
                $0.label.lowercased().contains(q) || $0.provider.lowercased().contains(q)
            }
            let grouped = Dictionary(grouping: models) { $0.provider }
                .sorted { $0.key < $1.key }

            List {
                ForEach(grouped, id: \.key) { provider, providerModels in
                    Section(provider) {
                        ForEach(providerModels) { model in
                            Button {
                                Task { await vm.setModel(model) }
                                dismiss()
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(model.label)
                                            .font(.body)
                                            .foregroundStyle(.primary)
                                        if let ctx = model.contextWindow {
                                            Text("\(ctx / 1000)k context")
                                                .font(.caption2)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    Spacer()
                                    if model.reasoning == true {
                                        Image(systemName: "brain")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    if vm.currentModel?.id == model.id {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(theme.accent)
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .task { await vm.loadModels() }
        }
    }

    // MARK: - Thinking Picker

    @ViewBuilder
    private var thinkingPickerView: some View {
        if let vm = viewModel {
            List {
                ForEach(ChatViewModel.thinkingLevels, id: \.self) { level in
                    Button {
                        Task { await vm.setThinking(level) }
                        dismiss()
                    } label: {
                        HStack {
                            Image(systemName: thinkingIcon(level))
                                .frame(width: 28)
                                .foregroundStyle(theme.accent)
                            Text(level.capitalized)
                                .foregroundStyle(.primary)
                            Spacer()
                            if vm.thinkingLevel == level {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(theme.accent)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .listStyle(.insetGrouped)
        }
    }

    private func thinkingIcon(_ level: String) -> String {
        switch level {
        case "off": return "moon"
        case "low": return "sparkle"
        case "medium": return "sparkles"
        case "high": return "brain.head.profile"
        default: return "brain"
        }
    }

    // MARK: - Slash Commands (full list)

    @ViewBuilder
    private var slashCommandsView: some View {
        let eligible = commands.filter { !desktopOnly.contains($0.name) }
        let q = searchText.lowercased()
        let results = searchText.isEmpty ? eligible : eligible.filter {
            $0.name.lowercased().contains(q) ||
            $0.description.lowercased().contains(q) ||
            $0.displayName.lowercased().contains(q)
        }

        List {
            if results.isEmpty {
                ContentUnavailableView("No Results", systemImage: "magnifyingglass",
                                       description: Text("Try a different search term"))
            } else {
                let grouped = CommandCategory.allCases.compactMap { cat -> (CommandCategory, [SlashCommand])? in
                    let cmds = results.filter { $0.category == cat }
                    return cmds.isEmpty ? nil : (cat, cmds)
                }
                ForEach(grouped, id: \.0) { category, cmds in
                    Section(category.rawValue) {
                        ForEach(cmds) { cmd in commandRow(cmd) }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    // MARK: - Command Row

    private func commandRow(_ cmd: SlashCommand) -> some View {
        Button {
            recents.record(cmd.name)
            dismiss()
            onSelect(cmd)
        } label: {
            HStack(spacing: 12) {
                Text(cmd.icon)
                    .font(.title3)
                    .frame(width: 28, alignment: .center)
                VStack(alignment: .leading, spacing: 2) {
                    Text(cmd.name)
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
