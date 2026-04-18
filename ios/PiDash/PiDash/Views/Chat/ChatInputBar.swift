import SwiftUI

// MARK: - ChatInputBar

struct ChatInputBar: View {
    @Binding var text: String
    let isStreaming: Bool
    let onSend: () -> Void
    let onStop: () -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Message", text: $text, axis: .vertical)
                .lineLimit(1...6)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(Color(.systemGray6))
                )
                .submitLabel(.send)
                .onSubmit {
                    if !isStreaming && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        onSend()
                    }
                }

            Button(action: isStreaming ? onStop : onSend) {
                Image(systemName: isStreaming ? "stop.circle.fill" : "arrow.up.circle.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(isStreaming ? Color.red : (text.isEmpty ? Color.secondary : Color.accentColor))
                    .contentTransition(.symbolEffect(.replace))
                    .animation(.spring(duration: 0.3), value: isStreaming)
            }
            .disabled(!isStreaming && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(.bar)
    }
}
