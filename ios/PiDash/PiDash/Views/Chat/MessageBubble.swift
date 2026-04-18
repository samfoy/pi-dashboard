import SwiftUI
import MarkdownUI

// MARK: - MessageBubble

struct MessageBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if message.role == .user { Spacer(minLength: 60) }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 4) {
                bubbleContent
                if message.isStreaming {
                    StreamingCursor()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.leading, 4)
                }
            }

            if message.role == .assistant || message.role == .system {
                Spacer(minLength: 60)
            }
        }
    }

    @ViewBuilder
    private var bubbleContent: some View {
        switch message.role {
        case .user:
            Text(message.content)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color.accentColor)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        case .assistant:
            Markdown(message.content)
                .markdownTheme(.gitHub)
                .padding(.horizontal, 4)
                .padding(.vertical, 2)
        case .system, .tool:
            Text(message.content)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Color(.systemGray5))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }
}

// MARK: - StreamingCursor

struct StreamingCursor: View {
    @State private var isVisible = true

    var body: some View {
        Circle()
            .fill(Color.accentColor)
            .frame(width: 8, height: 8)
            .opacity(isVisible ? 1 : 0)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true)) {
                    isVisible = false
                }
            }
    }
}
