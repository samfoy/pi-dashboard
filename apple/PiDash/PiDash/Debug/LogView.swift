import SwiftUI

// MARK: - LogView

struct LogView: View {
    @StateObject private var logger = AppLogger.shared
    @State private var filterLevel: LogEntry.LogLevel? = nil
    @State private var filterCategory: String = ""
    @State private var showCopied = false
    @Environment(\.dismiss) private var dismiss

    private var filtered: [LogEntry] {
        logger.entries
            .filter { entry in
                if let level = filterLevel, entry.level != level { return false }
                if !filterCategory.isEmpty,
                   !entry.category.localizedCaseInsensitiveContains(filterCategory) &&
                   !entry.message.localizedCaseInsensitiveContains(filterCategory) { return false }
                return true
            }
            .reversed()   // newest first
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Filter bar
                VStack(spacing: 6) {
                    // Level filter pills
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            FilterPill(label: "All", active: filterLevel == nil) {
                                filterLevel = nil
                            }
                            ForEach(LogEntry.LogLevel.allCases, id: \.self) { level in
                                FilterPill(
                                    label: "\(level.symbol) \(level.rawValue)",
                                    active: filterLevel == level
                                ) {
                                    filterLevel = (filterLevel == level) ? nil : level
                                }
                            }
                        }
                        .padding(.horizontal, 12)
                    }

                    // Text filter
                    HStack {
                        Image(systemName: "magnifyingglass")
                            .foregroundStyle(.secondary)
                            .font(.caption)
                        TextField("Filter by category or message…", text: $filterCategory)
                            .font(.caption)
                        if !filterCategory.isEmpty {
                            Button { filterCategory = "" } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                    .padding(.horizontal, 12)
                }
                .padding(.vertical, 8)
                .background(.bar)

                Divider()

                if filtered.isEmpty {
                    ContentUnavailableView("No logs", systemImage: "doc.text",
                                          description: Text(logger.entries.isEmpty ? "Nothing logged yet." : "No entries match the filter."))
                } else {
                    List(filtered) { entry in
                        LogEntryRow(entry: entry)
                            .listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12))
                    }
                    .listStyle(.plain)
                    .font(.system(.caption, design: .monospaced))
                }
            }
            .navigationTitle("Logs (\(filtered.count))")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        UIPasteboard.general.string = logger.exportText
                        showCopied = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { showCopied = false }
                    } label: {
                        Label(showCopied ? "Copied!" : "Copy All", systemImage: showCopied ? "checkmark" : "doc.on.doc")
                            .font(.caption)
                    }

                    Button(role: .destructive) {
                        logger.clear()
                    } label: {
                        Label("Clear", systemImage: "trash")
                            .font(.caption)
                    }
                }
            }
        }
    }
}

// MARK: - LogEntryRow

private struct LogEntryRow: View {
    let entry: LogEntry
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .top, spacing: 6) {
                Text(entry.formattedTime)
                    .foregroundStyle(.secondary)
                    .fixedSize()
                Text("[\(entry.category)]")
                    .foregroundStyle(categoryColor)
                    .fixedSize()
                Text(entry.message)
                    .foregroundStyle(levelColor)
                    .lineLimit(expanded ? nil : 3)
            }
            if expanded {
                Text("\(entry.file):\(entry.line)")
                    .foregroundStyle(.tertiary)
                    .font(.system(size: 9, design: .monospaced))
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { withAnimation(.easeInOut(duration: 0.15)) { expanded.toggle() } }
    }

    private var levelColor: Color {
        switch entry.level {
        case .debug:   return .primary
        case .info:    return .primary
        case .warning: return .orange
        case .error:   return .red
        }
    }

    private var categoryColor: Color {
        // Stable color per category name
        let colors: [Color] = [.blue, .purple, .teal, .indigo, .cyan, .mint]
        let idx = abs(entry.category.hashValue) % colors.count
        return colors[idx]
    }
}

// MARK: - FilterPill

private struct FilterPill: View {
    let label: String
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.caption.weight(active ? .semibold : .regular))
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(active ? Color.accentColor.opacity(0.2) : Color.secondary.opacity(0.1),
                            in: Capsule())
                .foregroundStyle(active ? Color.accentColor : Color.secondary)
        }
        .buttonStyle(.plain)
    }
}
