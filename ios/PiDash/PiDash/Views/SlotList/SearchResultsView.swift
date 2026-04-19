import SwiftUI

// MARK: - SearchResultsView

struct SearchResultsView: View {
    let results: [SearchResult]
    let isSearching: Bool
    let query: String
    let onSelect: (ChatSlot, UUID) -> Void

    private var grouped: [(slot: ChatSlot, results: [SearchResult])] {
        var seen = [String: Int]()
        var groups: [(slot: ChatSlot, results: [SearchResult])] = []
        for result in results {
            if let idx = seen[result.slot.key] {
                groups[idx].results.append(result)
            } else {
                seen[result.slot.key] = groups.count
                groups.append((slot: result.slot, results: [result]))
            }
        }
        return groups
    }

    var body: some View {
        if isSearching && results.isEmpty {
            ProgressView("Searching…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if !isSearching && results.isEmpty && !query.isEmpty {
            ContentUnavailableView {
                Label("No Results", systemImage: "magnifyingglass")
            } description: {
                Text("No messages found matching \"\(query)\".")
            }
        } else if !results.isEmpty {
            List {
                ForEach(grouped, id: \.slot.key) { section in
                    Section {
                        ForEach(section.results) { result in
                            SearchResultRow(result: result, query: query)
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    onSelect(result.slot, result.message.id)
                                }
                        }
                    } header: {
                        Text(section.slot.title)
                            .font(.subheadline.bold())
                            .foregroundStyle(Color.accentColor)
                    }
                }
            }
            .listStyle(.insetGrouped)
        }
    }
}

// MARK: - SearchResultRow

private struct SearchResultRow: View {
    let result: SearchResult
    let query: String

    private var highlightedExcerpt: AttributedString {
        var attributed = AttributedString(result.excerpt)
        let nsExcerpt = result.excerpt as NSString
        var searchRange = NSRange(location: 0, length: nsExcerpt.length)
        while searchRange.length > 0 {
            let found = nsExcerpt.range(
                of: query,
                options: [.caseInsensitive, .diacriticInsensitive],
                range: searchRange
            )
            guard found.location != NSNotFound else { break }
            if let swiftRange = Range(found, in: result.excerpt),
               let attrRange = Range(swiftRange, in: attributed) {
                attributed[attrRange].foregroundColor = Color(red: 1.0, green: 0.75, blue: 0.0)
                attributed[attrRange].font = .body.bold()
            }
            let nextLoc = found.upperBound
            searchRange = NSRange(location: nextLoc, length: nsExcerpt.length - nextLoc)
        }
        return attributed
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(result.message.role == .user ? "You" : "Assistant")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                Spacer()
                Text(result.message.timestamp, style: .date)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            Text(highlightedExcerpt)
                .font(.subheadline)
                .lineLimit(3)
                .foregroundStyle(.primary)
        }
        .padding(.vertical, 2)
    }
}
