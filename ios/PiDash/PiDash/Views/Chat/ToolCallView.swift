import SwiftUI

// MARK: - ToolCallView

struct ToolCallView: View {
    let toolName: String
    let toolId: String
    var isExpanded: Bool = false
    var result: String? = nil
    var isError: Bool = false

    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button(action: { withAnimation(.spring(duration: 0.3)) { expanded.toggle() } }) {
                HStack(spacing: 6) {
                    Image(systemName: "wrench.and.screwdriver.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(toolName)
                        .font(.caption.monospaced())
                        .foregroundStyle(.primary)
                    Spacer()
                    if result != nil {
                        Image(systemName: isError ? "exclamationmark.circle" : "checkmark.circle")
                            .font(.caption)
                            .foregroundStyle(isError ? .red : .green)
                    }
                    Image(systemName: "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                }
            }
            .buttonStyle(.plain)

            if expanded, let result {
                Text(result)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .padding(8)
                    .background(Color(.systemGray6))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
        }
        .padding(10)
        .background(Color(.systemGray5))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .onAppear { expanded = isExpanded }
    }
}
