import SwiftUI

// MARK: - SystemPromptSheet

/// Shows the effective system prompt for a slot — static base, runtime (static + memory),
/// and memory-only. All three are exposed as segmented sections for quick comparison.
struct SystemPromptSheet: View {
    let slotKey: String
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appTheme) private var theme

    @State private var response: SystemPromptResponse?
    @State private var isLoading = true
    @State private var error: String?
    @State private var selection: Section = .runtime

    enum Section: String, CaseIterable, Identifiable {
        case staticPrompt = "Static"
        case runtime = "Runtime"
        case memory = "Memory"

        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error {
                    ContentUnavailableView {
                        Label("Couldn't load prompt", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    }
                } else if let response {
                    content(response)
                } else {
                    ContentUnavailableView("No prompt available", systemImage: "doc.text")
                }
            }
            .navigationTitle("System Prompt")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { dismiss() }
                }
                if let body = currentBody {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            UIPasteboard.general.string = body
                            HapticManager.messageSent()
                        } label: {
                            Image(systemName: "doc.on.doc")
                        }
                    }
                }
            }
        }
        .task { await load() }
    }

    private var currentBody: String? {
        guard let response else { return nil }
        switch selection {
        case .staticPrompt: return response.staticPrompt
        case .runtime: return response.runtime
        case .memory: return response.memory ?? ""
        }
    }

    @ViewBuilder
    private func content(_ response: SystemPromptResponse) -> some View {
        VStack(spacing: 0) {
            if let stats = response.memoryStats {
                HStack(spacing: 6) {
                    Image(systemName: "brain")
                        .font(.caption2)
                    Text("\(stats.semantic ?? 0) semantic facts \u{00B7} \(stats.lessons ?? 0) lessons")
                        .font(.caption)
                    Spacer()
                }
                .foregroundStyle(.secondary)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(theme.cardBg)
            }

            Picker("Section", selection: $selection) {
                ForEach(Section.allCases) { section in
                    Text(section.rawValue).tag(section)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            ScrollView {
                Text(currentBody ?? "")
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
            }
        }
    }

    private func load() async {
        isLoading = true
        error = nil
        do {
            let resp = try await appState.apiClient.fetchSystemPrompt(slot: slotKey)
            response = resp
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
