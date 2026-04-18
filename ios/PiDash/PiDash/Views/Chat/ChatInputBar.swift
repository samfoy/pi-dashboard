import SwiftUI

// MARK: - ChatInputBar

struct ChatInputBar: View {
    @Binding var text: String
    let isStreaming: Bool
    var isDisabled: Bool = false
    let onSend: () -> Void
    let onStop: () -> Void
    @FocusState private var isFocused: Bool

    private var canSend: Bool {
        !isStreaming && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isDisabled
    }

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
                .disabled(isDisabled)
                .focused($isFocused)
                .onSubmit {
                    if canSend {
                        isFocused = false
                        onSend()
                    }
                }

            Button(action: {
                if isStreaming {
                    onStop()
                } else {
                    isFocused = false
                    onSend()
                }
            }) {
                Image(systemName: isStreaming ? "stop.circle.fill" : "arrow.up.circle.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(
                        isStreaming ? Color.red
                            : (canSend ? Color.accentColor : Color.secondary)
                    )
                    .contentTransition(.symbolEffect(.replace))
                    .animation(.spring(duration: 0.3), value: isStreaming)
            }
            .disabled(!isStreaming && !canSend)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(.bar)
    }
}
