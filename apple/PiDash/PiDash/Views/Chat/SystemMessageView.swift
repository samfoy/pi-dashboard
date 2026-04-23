import SwiftUI

// MARK: - SystemMessageView

/// Renders structured system messages (process updates, subagent events) as styled notification bars.
/// Parses `[ad-process:*]` and `[ad-subagent:*]` prefixes from the content and meta.customType.
struct SystemMessageView: View {
    let content: String
    let customType: String?
    @Environment(\.appTheme) private var theme

    var body: some View {
        if let customType, customType.hasPrefix("ad-process:") {
            processUpdateView
        } else if let customType, customType.hasPrefix("ad-subagent:") {
            subagentView
        } else {
            genericSystemView
        }
    }

    // MARK: - Process Update

    private var processInfo: ProcessInfo {
        ProcessInfo.parse(content)
    }

    private var processUpdateView: some View {
        let info = processInfo
        return HStack(alignment: .top, spacing: 8) {
            Text(info.icon)
                .font(.body)
                .foregroundStyle(info.iconColor(theme: theme))

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(info.name)
                        .font(.caption.monospaced().bold())
                        .foregroundStyle(theme.text)
                    Text(info.statusLabel)
                        .font(.caption2.monospaced())
                        .foregroundStyle(info.iconColor(theme: theme))
                    if let duration = info.duration {
                        Text("(\(duration))")
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                    }
                }
                if let output = info.output {
                    Text(output)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(5)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(info.backgroundColor(theme: theme))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(info.borderColor(theme: theme), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    // MARK: - Subagent Update

    private var subagentView: some View {
        let text = content.replacing(/^\[ad-subagent:[^\]]*\]\s*/, with: "")
        let isComplete = text.range(of: #"complete|finished|done"#, options: .regularExpression, range: nil, locale: nil) != nil
        let isFail = text.range(of: #"failed|crashed|error"#, options: .regularExpression, range: nil, locale: nil) != nil

        let icon = isComplete ? "✓" : isFail ? "✗" : "⧖"
        let color: Color = isComplete ? .green : isFail ? .red : theme.accent

        return HStack(spacing: 8) {
            Text(icon)
                .font(.body)
                .foregroundStyle(color)
            Text(text)
                .font(.caption.monospaced())
                .foregroundStyle(theme.text)
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(color.opacity(0.06))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(color.opacity(0.3), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    // MARK: - Generic System

    private var genericSystemView: some View {
        let text = content.replacing(/^\[[^\]]*\]\s*/, with: "")
        return HStack(spacing: 8) {
            Text("ℹ")
                .font(.body)
                .foregroundStyle(.secondary)
            Text(text)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(theme.cardBg)
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(theme.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

// MARK: - ProcessInfo

private struct ProcessInfo {
    let name: String
    let isSuccess: Bool
    let isFail: Bool
    let isStart: Bool
    let duration: String?
    let output: String?

    var icon: String {
        isSuccess ? "✓" : isFail ? "✗" : isStart ? "▶" : "⚙"
    }

    var statusLabel: String {
        isSuccess ? "completed" : isFail ? "failed" : isStart ? "started" : "update"
    }

    func iconColor(theme: AppTheme) -> Color {
        isSuccess ? .green : isFail ? .red : isStart ? theme.accent : .secondary
    }

    func backgroundColor(theme: AppTheme) -> Color {
        let base: Color = isSuccess ? .green : isFail ? .red : isStart ? theme.accent : theme.cardBg
        return isSuccess || isFail || isStart ? base.opacity(0.06) : theme.cardBg
    }

    func borderColor(theme: AppTheme) -> Color {
        let base: Color = isSuccess ? .green : isFail ? .red : isStart ? theme.accent : theme.border
        return isSuccess || isFail || isStart ? base.opacity(0.3) : theme.border
    }

    static func parse(_ content: String) -> ProcessInfo {
        let text = content.replacing(/^\[ad-process:[^\]]*\]\s*/, with: "")

        let nameMatch = text.firstMatch(of: /Process '([^']+)'/)
        let name = nameMatch.map { String($0.1) } ?? "process"

        let isSuccess = text.range(of: #"completed?\s*successfully|finished|done"#, options: .regularExpression) != nil
        let isFail = text.range(of: #"failed|crashed|error|killed|exited"#, options: .regularExpression) != nil
        let isStart = text.range(of: #"started|running|launched"#, options: .regularExpression) != nil

        let durationMatch = text.firstMatch(of: /\(([^)]*\d+[^)]*)\)\s*$/)
        let duration = durationMatch.map { String($0.1) }

        let lines = text.components(separatedBy: "\n")
        let output = lines.count > 1 ? lines.dropFirst().joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines) : nil

        return ProcessInfo(name: name, isSuccess: isSuccess, isFail: isFail, isStart: isStart, duration: duration, output: output)
    }
}
