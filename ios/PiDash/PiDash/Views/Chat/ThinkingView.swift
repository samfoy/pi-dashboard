import SwiftUI

// MARK: - ThinkingView

struct ThinkingView: View {
    var content: String = ""
    var isActive: Bool = false
    @State private var expanded = false
    @State private var startTime: Date?
    @State private var thinkingSeconds: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button(action: { withAnimation(.spring(duration: 0.3)) { expanded.toggle() } }) {
                HStack(spacing: 6) {
                    Image(systemName: "brain")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .symbolEffect(.pulse, isActive: isActive)
                    Text(headerLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                }
            }
            .buttonStyle(.plain)
            .onChange(of: isActive) { _, active in
                if active {
                    startTime = Date()
                    thinkingSeconds = nil
                } else if let start = startTime {
                    thinkingSeconds = max(1, Int(Date().timeIntervalSince(start)))
                    startTime = nil
                }
            }

            if expanded, !content.isEmpty {
                Text(content)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .italic()
                    .padding(8)
                    .background(Color(.systemGray6))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
        }
        .padding(10)
        .background(Color(.systemGray5))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var headerLabel: String {
        if isActive { return "Thinking\u{2026}" }
        if let secs = thinkingSeconds { return "Thought for \(secs)s" }
        return "Thought"
    }
}
