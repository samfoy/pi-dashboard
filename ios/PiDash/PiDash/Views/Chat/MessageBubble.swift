import SwiftUI
import MarkdownUI

// MARK: - MessageBubble

struct MessageBubble: View {
    let message: ChatMessage
    @State private var showTimestamp = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if message.role == .user { Spacer(minLength: 60) }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 4) {
                bubbleContent
                if showTimestamp {
                    Text(timestampText)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 4)
                        .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .top)))
                }
                if message.isStreaming {
                    StreamingCursor()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.leading, 4)
                }
            }
            .onTapGesture {
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) {
                    showTimestamp.toggle()
                }
            }

            if message.role == .assistant || message.role == .system
                || message.role == .tool || message.role == .thinking {
                Spacer(minLength: 60)
            }
        }
    }

    private var timestampText: String {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        if Calendar.current.isDateInToday(message.timestamp) {
            formatter.dateStyle = .none
        } else if Calendar.current.isDateInYesterday(message.timestamp) {
            return "Yesterday " + DateFormatter.localizedString(
                from: message.timestamp, dateStyle: .none, timeStyle: .short)
        } else {
            formatter.dateStyle = .medium
        }
        return formatter.string(from: message.timestamp)
    }

    /// Strip `![image](data:...)` markdown references and `[Images saved to disk: ...]` annotations from text
    private var userTextContent: String {
        message.content
            .replacingOccurrences(
                of: #"!\[image\]\(data:[^)]*\)"#,
                with: "",
                options: .regularExpression
            )
            .replacingOccurrences(
                of: #"\[Images saved to disk:[^\]]*\]"#,
                with: "",
                options: .regularExpression
            )
            .replacingOccurrences(
                of: #"\[image — already processed in earlier turn\]"#,
                with: "",
                options: .regularExpression
            )
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Whether the original content contained image markdown references
    private var hasImageReferences: Bool {
        message.content.range(of: #"!\[image\]\(data:"#, options: .regularExpression) != nil
    }

    @ViewBuilder
    private var bubbleContent: some View {
        switch message.role {
        case .user:
            VStack(alignment: .trailing, spacing: 6) {
                // Render inline images
                if !message.imageData.isEmpty {
                    UserImagesView(imageData: message.imageData)
                } else if hasImageReferences {
                    // History fallback — no image data available
                    HStack(spacing: 4) {
                        Image(systemName: "photo")
                            .font(.caption)
                        Text("Image attached")
                            .font(.caption)
                    }
                    .foregroundStyle(.white.opacity(0.7))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color.accentColor.opacity(0.7))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                // Render text (stripping image markdown)
                let text = userTextContent
                if !text.isEmpty {
                    Text(text)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(Color.accentColor)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .contextMenu {
                            Button {
                                UIPasteboard.general.string = text
                            } label: {
                                Label("Copy", systemImage: "doc.on.doc")
                            }
                        }
                }
            }

        case .assistant:
            AssistantMessageContent(content: message.content)
                .contextMenu {
                    Button {
                        UIPasteboard.general.string = message.content
                    } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                    Button {
                        UIPasteboard.general.string = message.content
                    } label: {
                        Label("Copy Markdown", systemImage: "text.badge.plus")
                    }
                }

        case .thinking:
            ThinkingView(content: message.content, isActive: message.isStreaming)

        case .tool:
            ToolCallView(
                toolName: message.meta?.toolName ?? message.content,
                toolId: message.meta?.toolCallId ?? "",
                args: message.meta?.toolArgs,
                result: message.meta?.toolResult,
                isError: message.meta?.isError ?? false
            )

        case .system:
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

// MARK: - UserImagesView

private struct UserImagesView: View {
    let imageData: [Data]

    var body: some View {
        if imageData.count == 1, let uiImage = UIImage(data: imageData[0]) {
            Image(uiImage: uiImage)
                .resizable()
                .aspectRatio(contentMode: .fill)
                .frame(maxWidth: 240, maxHeight: 320)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Array(imageData.enumerated()), id: \.offset) { _, data in
                        if let uiImage = UIImage(data: data) {
                            Image(uiImage: uiImage)
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                                .frame(width: 160, height: 160)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                    }
                }
            }
        }
    }
}

// MARK: - StreamingCursor

struct StreamingCursor: View {
    @State private var isVisible = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Circle()
            .fill(Color.accentColor)
            .frame(width: 8, height: 8)
            .opacity(isVisible ? 1 : 0)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true)) {
                    isVisible = false
                }
            }
    }
}
