import SwiftUI

// MARK: - SlotRow

struct SlotRow: View {
    let slot: ChatSlot
    @Environment(\.appTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(slot.title)
                    .font(.headline)
                    .lineLimit(1)
                Spacer()
                if slot.inputNeeded {
                    Circle()
                        .fill(theme.accent)
                        .frame(width: 8, height: 8)
                }
                Text(RelativeTimeFormatter.string(from: slot.updatedAt))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let preview = slot.lastMessage {
                Text(preview)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            if slot.isStreaming {
                HStack(spacing: 4) {
                    ProgressView()
                        .controlSize(.mini)
                    Text("Generating…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if !slot.tags.isEmpty {
                HStack(spacing: 4) {
                    ForEach(slot.tags, id: \.self) { tag in
                        Text(tag)
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(theme.accent.opacity(0.15))
                            .foregroundStyle(theme.accent)
                            .clipShape(Capsule())
                    }
                }
            }
        }
        .padding(.vertical, 2)
    }
}
