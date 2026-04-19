import SwiftUI
import UIKit

struct ShareView: View {
    @State var viewModel: ShareViewModel
    let onCancel: () -> Void

    var body: some View {
        NavigationStack {
            Group {
                switch viewModel.state {
                case .loadingContent:
                    loadingView(label: "Loading content…")
                case .loadingSlots:
                    loadingView(label: "Fetching chats…")
                case .sending:
                    loadingView(label: "Sending to Pi…")
                case .success:
                    successView
                case .error(let msg):
                    errorView(message: msg)
                case .idle:
                    mainContent
                }
            }
            .navigationTitle("Send to Pi")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                        .disabled(viewModel.state == .sending)
                }
            }
        }
        .task {
            await viewModel.loadContent()
        }
    }

    // MARK: - Main content

    private var mainContent: some View {
        Form {
            // Quick action chips
            Section {
                ActionChipRow(selectedAction: $viewModel.selectedAction)
                    .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
                    .listRowBackground(Color.clear)
            }
            // Content preview
            if let content = viewModel.sharedContent {
                Section("Shared Content") {
                    contentPreview(content)
                }
            }

            // Optional message
            Section("Message (optional)") {
                TextField("Add a message…", text: $viewModel.additionalMessage, axis: .vertical)
                    .lineLimit(3...6)
            }

            // Chat picker
            Section("Send to") {
                Picker("Chat", selection: $viewModel.selectedSlotID) {
                    Text("New Chat").tag(String?.none)
                    ForEach(viewModel.availableSlots) { slot in
                        Text(slot.title).tag(String?.some(slot.id))
                    }
                }
                .pickerStyle(.menu)
            }

            // Send button
            Section {
                Button {
                    Task { await viewModel.send() }
                } label: {
                    Label("Send to Pi", systemImage: "paperplane.fill")
                        .frame(maxWidth: .infinity, alignment: .center)
                        .fontWeight(.semibold)
                }
                .buttonStyle(.borderedProminent)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            }
        }
    }

    // MARK: - Content preview

    @ViewBuilder
    private func contentPreview(_ content: SharedContent) -> some View {
        switch content {
        case .text(let text):
            Text(text)
                .lineLimit(4)
                .font(.body)
                .foregroundStyle(.secondary)
        case .url(let url):
            Label(url.absoluteString, systemImage: "link")
                .lineLimit(2)
                .font(.footnote)
                .foregroundStyle(.secondary)
        case .image(let image):
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxHeight: 200)
                .clipShape(RoundedRectangle(cornerRadius: 8))
        case .file(let name, let data):
            Label("\(name) (\(ByteCountFormatter.string(fromByteCount: Int64(data.count), countStyle: .file)))",
                  systemImage: "doc")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

// MARK: - Action chip row

private struct ActionChipRow: View {
    @Binding var selectedAction: ShareAction

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(ShareAction.allCases, id: \.label) { action in
                    Button(action.label) {
                        selectedAction = action
                    }
                    .buttonStyle(.bordered)
                    .tint(selectedAction == action ? .accentColor : nil)
                    .fontWeight(selectedAction == action ? .semibold : .regular)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
        }
    }
}

    private func loadingView(label: String) -> some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.4)
            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private var successView: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 56))
                .foregroundStyle(.green)
            Text("Sent!")
                .font(.title2.bold())
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private func errorView(message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 48))
                .foregroundStyle(.orange)
            Text("Something went wrong")
                .font(.title3.bold())
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Try Again") {
                Task { await viewModel.fetchSlots() }
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}
