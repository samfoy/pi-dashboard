import SwiftUI

// MARK: - ToolCallView

struct ToolCallView: View {
    let toolName: String
    let toolId: String
    var args: String? = nil
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
                    } else {
                        ProgressView()
                            .controlSize(.mini)
                    }
                    Image(systemName: "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                }
            }
            .buttonStyle(.plain)

            if expanded {
                VStack(alignment: .leading, spacing: 6) {
                    if let args, !args.isEmpty {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Arguments")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .textCase(.uppercase)
                            Text(String(args.prefix(300)))
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                                .padding(8)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color(.systemGray6))
                                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        }
                    }
                    if let result {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Result")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .textCase(.uppercase)
                            Text(String(result.prefix(500)))
                                .font(.caption.monospaced())
                                .foregroundStyle(isError ? .red : .secondary)
                                .padding(8)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color(.systemGray6))
                                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        }
                    }
                }
            }
        }
        .padding(10)
        .background(Color(.systemGray5))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
