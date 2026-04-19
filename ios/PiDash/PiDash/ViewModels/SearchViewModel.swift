import Foundation

// MARK: - SearchResult

struct SearchResult: Identifiable {
    let id: UUID
    let slot: ChatSlot
    let message: ChatMessage
    let excerpt: String
}

// MARK: - SearchViewModel

@MainActor
@Observable
final class SearchViewModel {
    var results: [SearchResult] = []
    var isSearching: Bool = false
    var errorMessage: String? = nil

    private var searchTask: Task<Void, Never>? = nil

    func search(query: String, slots: [ChatSlot], apiClient: APIClient) {
        searchTask?.cancel()

        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else {
            results = []
            isSearching = false
            return
        }

        searchTask = Task {
            // 300ms debounce
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }

            isSearching = true
            errorMessage = nil

            let q = trimmed.lowercased()
            var found: [SearchResult] = []

            await withTaskGroup(of: [SearchResult].self) { group in
                for slot in slots {
                    group.addTask {
                        guard !Task.isCancelled else { return [] }
                        do {
                            let messages = try await apiClient.fetchSlotDetail(key: slot.key)
                            return messages.compactMap { message in
                                guard message.content.lowercased().contains(q) else { return nil }
                                let excerpt = Self.makeExcerpt(content: message.content, query: q)
                                return SearchResult(
                                    id: message.id,
                                    slot: slot,
                                    message: message,
                                    excerpt: excerpt
                                )
                            }
                        } catch {
                            return []
                        }
                    }
                }
                for await slotResults in group {
                    found.append(contentsOf: slotResults)
                }
            }

            guard !Task.isCancelled else { return }

            // Most recent messages first
            found.sort { $0.message.timestamp > $1.message.timestamp }
            results = found
            isSearching = false
        }
    }

    func clear() {
        searchTask?.cancel()
        results = []
        isSearching = false
        errorMessage = nil
    }

    // MARK: - Helpers

    private nonisolated static func makeExcerpt(content: String, query: String) -> String {
        guard let matchRange = content.range(of: query, options: [.caseInsensitive, .diacriticInsensitive]) else {
            return String(content.prefix(120))
        }
        let matchOffset = content.distance(from: content.startIndex, to: matchRange.lowerBound)
        let contextStart = max(0, matchOffset - 40)
        let startIndex = content.index(content.startIndex, offsetBy: contextStart)
        let endOffset = min(contextStart + 120, content.count)
        let endIndex = content.index(content.startIndex, offsetBy: endOffset)

        let prefix = contextStart > 0 ? "…" : ""
        let suffix = endOffset < content.count ? "…" : ""
        return prefix + String(content[startIndex..<endIndex]) + suffix
    }
}
