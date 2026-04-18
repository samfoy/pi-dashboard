import SwiftUI

// MARK: - ThinkingView

struct ThinkingView: View {
    var content: String = ""
    var isActive: Bool = false
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button(action: { withAnimation(.spring(duration: 0.3)) { expanded.toggle() } }) {
                HStack(spacing: 6) {
                    Image(systemName: "brain")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .symbolEffect(.pulse, isActive: isActive)
                    Text(isActive ? "Thinking…" : "Thought")
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
}
