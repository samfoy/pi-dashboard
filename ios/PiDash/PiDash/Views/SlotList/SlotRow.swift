import SwiftUI

// MARK: - SlotRow

struct SlotRow: View {
    let slot: ChatSlot

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(slot.title)
                    .font(.headline)
                    .lineLimit(1)
                Spacer()
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
        }
        .padding(.vertical, 2)
    }
}
