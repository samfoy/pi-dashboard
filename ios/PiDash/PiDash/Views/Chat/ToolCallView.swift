import SwiftUI
import MarkdownUI

// MARK: - ToolCallView

struct ToolCallView: View {
    let toolName: String
    let toolId: String
    var args: String? = nil
    var result: String? = nil
    var isError: Bool = false

    @State private var expanded = false

    private var parsedArgs: [String: Any]? {
        guard let args, let data = args.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            toolHeader
            if expanded {
                Divider()
                toolDetail
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .background(Color(.systemGray5))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color(.separator), lineWidth: 0.5)
        )
    }

    // MARK: - Header

    private var toolHeader: some View {
        Button(action: { withAnimation(.spring(duration: 0.25)) { expanded.toggle() } }) {
            HStack(spacing: 8) {
                Image(systemName: toolIcon)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(toolColor)
                    .frame(width: 20)

                Text(toolLabel)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                Spacer()

                if result != nil {
                    Image(systemName: isError ? "xmark.circle.fill" : "checkmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(isError ? .red : .green)
                } else {
                    ProgressView()
                        .controlSize(.mini)
                }

                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.tertiary)
                    .rotationEffect(.degrees(expanded ? 90 : 0))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Detail (tool-specific)

    @ViewBuilder
    private var toolDetail: some View {
        switch toolName {
        case "read":
            ReadToolDetail(args: parsedArgs, result: result)
        case "edit":
            EditToolDetail(args: parsedArgs, result: result)
        case "write":
            WriteToolDetail(args: parsedArgs, result: result)
        case "bash":
            BashToolDetail(args: parsedArgs, result: result)
        default:
            GenericToolDetail(args: args, result: result, isError: isError)
        }
    }

    // MARK: - Tool metadata

    private var toolIcon: String {
        switch toolName {
        case "read": return "doc.text"
        case "edit": return "pencil.line"
        case "write": return "doc.badge.plus"
        case "bash": return "terminal"
        case "web_search": return "globe"
        case "process": return "gearshape.2"
        default: return "wrench.and.screwdriver"
        }
    }

    private var toolColor: Color {
        switch toolName {
        case "read": return .blue
        case "edit": return .orange
        case "write": return .green
        case "bash": return .purple
        default: return .secondary
        }
    }

    private var toolLabel: String {
        let parsed = parsedArgs
        switch toolName {
        case "read":
            if let path = parsed?["path"] as? String {
                return "read \(shortenPath(path))"
            }
            return "read"
        case "edit":
            if let path = parsed?["path"] as? String {
                return "edit \(shortenPath(path))"
            }
            return "edit"
        case "write":
            if let path = parsed?["path"] as? String {
                return "write \(shortenPath(path))"
            }
            return "write"
        case "bash":
            if let cmd = parsed?["command"] as? String {
                let first = cmd.trimmingCharacters(in: .whitespacesAndNewlines)
                    .components(separatedBy: .newlines).first ?? cmd
                return "bash: \(String(first.prefix(50)))"
            }
            return "bash"
        default:
            return toolName
        }
    }

    private func shortenPath(_ path: String) -> String {
        let components = path.components(separatedBy: "/")
        if components.count > 3 {
            return "…/" + components.suffix(2).joined(separator: "/")
        }
        return path
    }
}

// MARK: - Read Tool Detail

private struct ReadToolDetail: View {
    let args: [String: Any]?
    let result: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let path = args?["path"] as? String {
                PathLabel(path: path)
            }
            if let result, !result.isEmpty {
                filePreview(result, language: fileLanguage)
            }
        }
        .padding(10)
    }

    private var fileLanguage: String? {
        guard let path = args?["path"] as? String else { return nil }
        let ext = (path as NSString).pathExtension.lowercased()
        let map = ["swift": "swift", "ts": "typescript", "tsx": "typescript",
                    "js": "javascript", "py": "python", "rs": "rust",
                    "json": "json", "yml": "yaml", "yaml": "yaml",
                    "md": "markdown", "sh": "bash", "css": "css", "html": "html"]
        return map[ext]
    }
}

// MARK: - Edit Tool Detail

private struct EditToolDetail: View {
    let args: [String: Any]?
    let result: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let path = args?["path"] as? String {
                PathLabel(path: path)
            }
            if let edits = args?["edits"] as? [[String: Any]] {
                ForEach(Array(edits.prefix(3).enumerated()), id: \.offset) { _, edit in
                    DiffView(
                        oldText: edit["oldText"] as? String ?? "",
                        newText: edit["newText"] as? String ?? ""
                    )
                }
                if edits.count > 3 {
                    Text("+ \(edits.count - 3) more edit(s)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if let result, !result.isEmpty {
                Text(result)
                    .font(.caption)
                    .foregroundStyle(.green)
                    .padding(.top, 2)
            }
        }
        .padding(10)
    }
}

// MARK: - Write Tool Detail

private struct WriteToolDetail: View {
    let args: [String: Any]?
    let result: String?

    @State private var showContent = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let path = args?["path"] as? String {
                PathLabel(path: path)
            }
            if let content = args?["content"] as? String, !content.isEmpty {
                Button {
                    withAnimation(.spring(duration: 0.2)) { showContent.toggle() }
                } label: {
                    HStack(spacing: 4) {
                        Text(showContent ? "Hide content" : "Show content (\(content.count) chars)")
                            .font(.caption)
                        Image(systemName: "chevron.right")
                            .font(.caption2)
                            .rotationEffect(.degrees(showContent ? 90 : 0))
                    }
                    .foregroundStyle(Color.accentColor)
                }
                .buttonStyle(.plain)

                if showContent {
                    filePreview(content, language: fileLanguage)
                }
            }
            if let result, !result.isEmpty {
                Text(result)
                    .font(.caption)
                    .foregroundStyle(.green)
                    .padding(.top, 2)
            }
        }
        .padding(10)
    }

    private var fileLanguage: String? {
        guard let path = args?["path"] as? String else { return nil }
        let ext = (path as NSString).pathExtension.lowercased()
        let map = ["swift": "swift", "ts": "typescript", "tsx": "typescript",
                    "js": "javascript", "py": "python", "json": "json",
                    "md": "markdown", "sh": "bash"]
        return map[ext]
    }
}

// MARK: - Bash Tool Detail

private struct BashToolDetail: View {
    let args: [String: Any]?
    let result: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let cmd = args?["command"] as? String {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(cmd)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(.primary)
                        .padding(8)
                }
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
            if let result, !result.isEmpty {
                ScrollView {
                    Text(String(result.prefix(2000)))
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 200)
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
        }
        .padding(10)
    }
}

// MARK: - Generic Tool Detail

private struct GenericToolDetail: View {
    let args: String?
    let result: String?
    let isError: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let args, !args.isEmpty {
                Text(String(args.prefix(300)))
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.systemGray6))
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
            if let result, !result.isEmpty {
                Text(String(result.prefix(500)))
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(isError ? .red : .secondary)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.systemGray6))
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
        }
        .padding(10)
    }
}

// MARK: - Shared Components

private struct PathLabel: View {
    let path: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "folder")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(path)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }
}

private struct DiffView: View {
    let oldText: String
    let newText: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if !oldText.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(truncate(oldText))
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.red)
                        .padding(6)
                }
                .background(Color.red.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
            }
            if !newText.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(truncate(newText))
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.green)
                        .padding(6)
                }
                .background(Color.green.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
            }
        }
    }

    private func truncate(_ text: String) -> String {
        let lines = text.components(separatedBy: .newlines)
        if lines.count > 8 {
            return lines.prefix(6).joined(separator: "\n") + "\n… +\(lines.count - 6) more lines"
        }
        return String(text.prefix(500))
    }
}

/// File content preview with optional syntax hint
private func filePreview(_ content: String, language: String? = nil) -> some View {
    let preview = String(content.prefix(1500))
    let lines = preview.components(separatedBy: .newlines)
    let display = lines.count > 20
        ? lines.prefix(18).joined(separator: "\n") + "\n… +\(lines.count - 18) more lines"
        : preview

    return ScrollView(.horizontal, showsIndicators: false) {
        Text(display)
            .font(.system(size: 11, design: .monospaced))
            .foregroundStyle(.primary)
            .padding(8)
    }
    .frame(maxHeight: 250)
    .background(Color(.systemGray6))
    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    .overlay(
        RoundedRectangle(cornerRadius: 6, style: .continuous)
            .stroke(Color(.separator), lineWidth: 0.5)
    )
}
