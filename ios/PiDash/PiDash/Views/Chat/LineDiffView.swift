import SwiftUI

// MARK: - Diff Data Types

enum DiffLineKind {
    case context, removed, added
}

struct DiffLine: Identifiable {
    let id: Int
    let kind: DiffLineKind
    let text: String
}

struct DiffHunk: Identifiable {
    let id: Int
    let lines: [DiffLine]

    /// True if any line is added or removed (i.e. not a pure-context gap hunk).
    var hasChanges: Bool {
        lines.contains { $0.kind != .context }
    }
}

// MARK: - Diff Engine

enum LineDiff {
    static let contextRadius = 3

    /// Returns hunks suitable for rendering.
    static func compute(old: String, new: String) -> [DiffHunk] {
        let oldLines = old.components(separatedBy: "\n")
        let newLines = new.components(separatedBy: "\n")
        let tagged = taggedLines(old: oldLines, new: newLines)
        return groupHunks(tagged: tagged)
    }

    // MARK: Private helpers

    /// Builds a flat list of DiffLine values by merging old/new with CollectionDifference.
    private static func taggedLines(old: [String], new: [String]) -> [DiffLine] {
        let diff = new.difference(from: old)

        var removals = Set<Int>()
        var insertionSet = Set<Int>()

        for change in diff {
            switch change {
            case .remove(let offset, _, _): removals.insert(offset)
            case .insert(let offset, _, _): insertionSet.insert(offset)
            @unknown default: break
            }
        }

        var result = [DiffLine]()
        var newIdx = 0
        var lineId = 0

        for oldIdx in 0..<old.count {
            if removals.contains(oldIdx) {
                result.append(DiffLine(id: lineId, kind: .removed, text: old[oldIdx]))
                lineId += 1
            } else {
                // Context line — flush any insertions that precede it in new
                while newIdx < new.count && insertionSet.contains(newIdx) {
                    result.append(DiffLine(id: lineId, kind: .added, text: new[newIdx]))
                    lineId += 1
                    newIdx += 1
                }
                result.append(DiffLine(id: lineId, kind: .context, text: old[oldIdx]))
                lineId += 1
                newIdx += 1
            }
        }

        // Trailing insertions
        while newIdx < new.count {
            if insertionSet.contains(newIdx) {
                result.append(DiffLine(id: lineId, kind: .added, text: new[newIdx]))
                lineId += 1
            }
            newIdx += 1
        }

        return result
    }

    /// Groups a flat tagged line list into hunks:
    /// change hunks (± contextRadius context lines around changes) and
    /// gap hunks (pure-context runs between change hunks — these are collapsible).
    private static func groupHunks(tagged: [DiffLine]) -> [DiffHunk] {
        guard !tagged.isEmpty else { return [] }

        let changeIndices = tagged.indices.filter { tagged[$0].kind != .context }
        guard !changeIndices.isEmpty else {
            // All context — single collapsible hunk
            return [DiffHunk(id: 0, lines: tagged)]
        }

        // Build merged ranges around each change (± contextRadius), collapsing overlaps
        var ranges = [Range<Int>]()
        for idx in changeIndices {
            let lo = max(0, idx - contextRadius)
            let hi = min(tagged.count, idx + contextRadius + 1)
            if let last = ranges.last, lo <= last.upperBound {
                ranges[ranges.count - 1] = last.lowerBound..<max(last.upperBound, hi)
            } else {
                ranges.append(lo..<hi)
            }
        }

        var hunks = [DiffHunk]()
        var hunkId = 0
        var cursor = 0

        for range in ranges {
            // Gap before this change hunk → collapsible context hunk
            if cursor < range.lowerBound {
                hunks.append(DiffHunk(id: hunkId, lines: Array(tagged[cursor..<range.lowerBound])))
                hunkId += 1
            }
            // The change hunk itself (includes surrounding context lines)
            hunks.append(DiffHunk(id: hunkId, lines: Array(tagged[range])))
            hunkId += 1
            cursor = range.upperBound
        }

        // Trailing context
        if cursor < tagged.count {
            hunks.append(DiffHunk(id: hunkId, lines: Array(tagged[cursor...])))
        }

        return hunks
    }
}

// MARK: - LineDiffView

/// Renders a line-level unified diff between `old` and `new` strings.
/// Change hunks are always visible; pure-context blocks between hunks are collapsible.
struct LineDiffView: View {
    let old: String
    let new: String

    @State private var hunks: [DiffHunk] = [DiffHunk]()
    @State private var expandedHunks: Set<Int> = Set<Int>()
    @State private var isComputing: Bool = true

    var body: some View {
        Group {
            if isComputing {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if hunks.isEmpty || !hunks.contains(where: { $0.hasChanges }) {
                VStack(spacing: 8) {
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 32))
                        .foregroundStyle(.secondary)
                    Text("No differences")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                diffContent
            }
        }
        .task(id: old + "||" + new) {
            isComputing = true
            let result = await Task.detached(priority: .userInitiated) {
                LineDiff.compute(old: old, new: new)
            }.value
            hunks = result
            isComputing = false
        }
    }

    private var diffContent: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(hunks) { hunk in
                    if hunk.hasChanges {
                        ForEach(hunk.lines) { line in
                            DiffLineRow(line: line)
                        }
                        Divider()
                    } else {
                        CollapsibleContextBlock(
                            hunk: hunk,
                            isExpanded: expandedHunks.contains(hunk.id),
                            onToggle: {
                                if expandedHunks.contains(hunk.id) {
                                    expandedHunks.remove(hunk.id)
                                } else {
                                    expandedHunks.insert(hunk.id)
                                }
                            }
                        )
                        Divider()
                    }
                }
            }
        }
    }
}

// MARK: - DiffLineRow

private struct DiffLineRow: View {
    let line: DiffLine
    @Environment(\.appTheme) private var theme

    private var background: Color {
        switch line.kind {
        case .added:   return theme.diffAdded
        case .removed: return theme.diffRemoved
        case .context: return Color.clear
        }
    }

    private var prefixSymbol: String {
        switch line.kind {
        case .added:   return "+"
        case .removed: return "-"
        case .context: return " "
        }
    }

    private var prefixColor: Color {
        switch line.kind {
        case .added:   return theme.success
        case .removed: return theme.error
        case .context: return theme.textMuted
        }
    }

    var body: some View {
        HStack(spacing: 0) {
            Text(prefixSymbol)
                .frame(width: 16, alignment: .leading)
                .foregroundStyle(prefixColor)
            Text(line.text)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.system(.caption2, design: .monospaced))
        .padding(.horizontal, 12)
        .padding(.vertical, 1)
        .background(background)
    }
}

// MARK: - CollapsibleContextBlock

private struct CollapsibleContextBlock: View {
    let hunk: DiffHunk
    let isExpanded: Bool
    let onToggle: () -> Void
    @Environment(\.appTheme) private var theme

    var body: some View {
        if isExpanded {
            ForEach(hunk.lines) { line in
                DiffLineRow(line: line)
            }
            Button(action: onToggle) {
                Label("Collapse", systemImage: "chevron.up")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .background(theme.codeBlockBg)
            }
            .buttonStyle(.plain)
        } else {
            Button(action: onToggle) {
                Label(
                    "\(hunk.lines.count) unchanged line\(hunk.lines.count == 1 ? "" : "s")",
                    systemImage: "chevron.down"
                )
                .font(.caption2)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
                .background(theme.codeBlockBg)
            }
            .buttonStyle(.plain)
        }
    }
}
