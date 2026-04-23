import SwiftUI
import MarkdownUI

// MARK: - AssistantMessageContent

/// Renders assistant message text with inline images parsed from markdown image syntax.
/// Segments ![alt](url) patterns out of the content; text segments go to Markdown,
/// image segments go to InlineImageView. Relative URLs are resolved against the server base URL.
struct AssistantMessageContent: View {
    let content: String
    @Environment((\.appTheme)) private var theme

    private var segments: [ContentSegment] { parseSegments(content) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                switch segment {
                case .text(let text):
                    if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Markdown(text)
                            .markdownTheme(.piDash(theme: theme))
                    }
                case .image(let url):
                    InlineImageView(url: url)
                        .padding(.vertical, 2)
                }
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
    }
}

// MARK: - ContentSegment

private enum ContentSegment {
    case text(String)
    case image(URL)
}

// MARK: - Parser

private func parseSegments(_ content: String) -> [ContentSegment] {
    guard let regex = try? NSRegularExpression(pattern: #"!\[([^\]]*)\]\(([^)]+)\)"#) else {
        return [.text(content)]
    }

    let nsContent = content as NSString
    let range = NSRange(location: 0, length: nsContent.length)
    let matches = regex.matches(in: content, range: range)

    guard !matches.isEmpty else { return [.text(content)] }

    var segments: [ContentSegment] = []
    var lastEnd = 0

    for match in matches {
        // Text before this image
        let textRange = NSRange(location: lastEnd, length: match.range.location - lastEnd)
        if textRange.length > 0 {
            segments.append(.text(nsContent.substring(with: textRange)))
        }

        // Image URL (capture group 2)
        let urlRange = match.range(at: 2)
        if urlRange.location != NSNotFound {
            let urlString = nsContent.substring(with: urlRange)
            if let url = resolveImageURL(urlString) {
                segments.append(.image(url))
            } else {
                segments.append(.text(nsContent.substring(with: match.range)))
            }
        }

        lastEnd = match.range.location + match.range.length
    }

    // Trailing text after last image
    if lastEnd < nsContent.length {
        segments.append(.text(nsContent.substring(from: lastEnd)))
    }

    return segments
}

private func resolveImageURL(_ urlString: String) -> URL? {
    // Absolute URLs pass through
    if urlString.hasPrefix("http://") || urlString.hasPrefix("https://") {
        return URL(string: urlString)
    }
    // data: URIs — skip, these are raw blobs not suitable for InlineImageView
    if urlString.hasPrefix("data:") {
        return nil
    }
    // Relative path — prepend server base URL
    let base = ServerConfig().baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let path = urlString.hasPrefix("/") ? urlString : "/\(urlString)"
    return URL(string: base + path)
}
