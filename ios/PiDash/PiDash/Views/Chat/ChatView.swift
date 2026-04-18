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
                        // Wire WS events from AppState to this view model
                        Task {
                            for await event in appState.wsManager.events {
                                vm.handle(event: event)
                            }
                        }
                    }
            }
        }
        .navigationTitle(viewModel?.slot.title ?? slot.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - ChatContentView

private struct ChatContentView: View {
    @Bindable var viewModel: ChatViewModel
    @State private var showJumpToBottom = false
    @State private var scrollOffset: CGFloat = 0

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            VStack(spacing: 0) {
                // Error banner
                if let error = viewModel.error {
                    HStack {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.white)
                        Spacer()
                        Button("Dismiss") { viewModel.error = nil }
                            .font(.caption.bold())
                            .foregroundStyle(.white)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Color.red)
                    .transition(.move(edge: .top).combined(with: .opacity))
                }

                messageList
                    .animation(.default, value: viewModel.messages.count)

                ChatInputBar(
                    text: $viewModel.inputText,
                    isStreaming: viewModel.isStreaming,
                    isDisabled: viewModel.isLoadingHistory,
                    onSend: { Task { await viewModel.send() } },
                    onStop: { Task { await viewModel.stop() } }
                )
            }

            // Jump-to-bottom FAB
            if showJumpToBottom {
                Button {
                    showJumpToBottom = false
                } label: {
                    Image(systemName: "arrow.down.circle.fill")
                        .font(.system(size: 32))
                        .foregroundStyle(Color.accentColor)
                        .background(Circle().fill(Color(.systemBackground)))
                        .shadow(radius: 4)
                }
                .padding(.trailing, 16)
                .padding(.bottom, 80)
                .transition(.scale.combined(with: .opacity))
            }
        }
        .animation(.spring(duration: 0.3), value: showJumpToBottom)
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                // Detect scroll offset to show/hide jump-to-bottom
                GeometryReader { geo in
                    Color.clear.preference(
                        key: ScrollOffsetKey.self,
                        value: geo.frame(in: .named("chatScroll")).minY
                    )
                }
                .frame(height: 0)

                LazyVStack(spacing: 12) {
                    if viewModel.isLoadingHistory {
                        ProgressView()
                            .padding()
                    }
                    ForEach(viewModel.messages) { message in
                        MessageBubble(message: message)
                            .id(message.id)
                            .transition(.opacity.combined(with: .move(edge: .bottom)))
                    }
                    // Invisible anchor at bottom
                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
            .coordinateSpace(name: "chatScroll")
            .onPreferenceChange(ScrollOffsetKey.self) { offset in
                // offset is negative when scrolled down; near zero when at top
                // We want to show FAB when user scrolled up significantly
                let threshold: CGFloat = -120
                showJumpToBottom = offset > threshold
            }
            .defaultScrollAnchor(.bottom)
            // Auto-scroll on new chunk or new message
            .onChange(of: viewModel.messages.last?.content) { _, _ in
                if !showJumpToBottom {
                    withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                }
            }
            .onChange(of: viewModel.messages.count) { _, _ in
                if !showJumpToBottom {
                    withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                }
            }
        }
    }
}

// MARK: - Scroll offset preference key

private struct ScrollOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}
