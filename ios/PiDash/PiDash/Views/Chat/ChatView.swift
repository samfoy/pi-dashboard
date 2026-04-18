import SwiftUI
import MarkdownUI

// MARK: - ChatView

struct ChatView: View {
    let slot: ChatSlot
    @Environment(AppState.self) private var appState
    @State private var viewModel: ChatViewModel?

    var body: some View {
        Group {
            if let vm = viewModel {
                ChatContentView(viewModel: vm)
            } else {
                ProgressView()
                    .task {
                        let vm = ChatViewModel(
                            slot: slot,
                            apiClient: appState.apiClient,
                            appState: appState
                        )
                        viewModel = vm
                        await vm.loadHistory()
                    }
            }
        }
        .navigationTitle(slot.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - ChatContentView

private struct ChatContentView: View {
    @Bindable var viewModel: ChatViewModel

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(viewModel.messages) { message in
                            MessageBubble(message: message)
                                .id(message.id)
                        }
                        Color.clear
                            .frame(height: 1)
                            .id("bottom")
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                }
                .defaultScrollAnchor(.bottom)
                .onChange(of: viewModel.messages.count) { _, _ in
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }

            ChatInputBar(
                text: $viewModel.inputText,
                isStreaming: viewModel.isStreaming,
                onSend: { Task { await viewModel.send() } },
                onStop: { Task { await viewModel.stop() } }
            )
        }
    }
}
