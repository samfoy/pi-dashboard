import SwiftUI

// MARK: - ForkPickerSheet

/// Lists past user messages in this slot's session tree. Tapping one forks the
/// conversation from that point and switches to the new slot.
struct ForkPickerSheet: View {
    let slotKey: String
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appTheme) private var theme

    @State private var entries: [SessionTreeEntryDTO] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var forking: String?   // entry id currently being forked
    @State private var cancelledAlert = false

    private var userEntries: [SessionTreeEntryDTO] {
        entries.filter { $0.role == "user" && $0.id != nil }
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error {
                    ContentUnavailableView {
                        Label("Couldn't load history", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    }
                } else if userEntries.isEmpty {
                    ContentUnavailableView(
                        "No forkable messages",
                        systemImage: "arrow.triangle.branch",
                        description: Text("This chat has no user messages to fork from.")
                    )
                } else {
                    list
                }
            }
            .navigationTitle("Fork from\u{2026}")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { dismiss() }
                }
            }
            .alert("Fork cancelled", isPresented: $cancelledAlert) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("Fork cancelled (agent may be mid-turn). Try again once the current turn finishes.")
            }
        }
        .task { await load() }
    }

    private var list: some View {
        List(userEntries, id: \.stableId) { entry in
            Button {
                guard let eid = entry.id else { return }
                Task { await fork(entryId: eid) }
            } label: {
                row(for: entry)
            }
            .disabled(forking != nil)
        }
        .listStyle(.plain)
    }

    private func row(for entry: SessionTreeEntryDTO) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "arrow.triangle.branch")
                .font(.caption)
                .foregroundStyle(theme.accent)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                Text(truncate(entry.text ?? entry.fullText ?? "(no text)"))
                    .font(.subheadline)
                    .foregroundStyle(.primary)
                    .lineLimit(3)
                if let ts = entry.timestamp, let formatted = formatTimestamp(ts) {
                    Text(formatted)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if forking == entry.id {
                ProgressView().controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }

    private func truncate(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count <= 140 { return trimmed }
        return String(trimmed.prefix(140)) + "\u{2026}"
    }

    private func formatTimestamp(_ raw: String) -> String? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = f.date(from: raw)
        if date == nil {
            f.formatOptions = [.withInternetDateTime]
            date = f.date(from: raw)
        }
        guard let d = date else { return nil }
        let display = DateFormatter()
        display.dateStyle = .short
        display.timeStyle = .short
        return display.string(from: d)
    }

    private func load() async {
        isLoading = true
        error = nil
        do {
            let tree = try await appState.apiClient.fetchSessionTree(slot: slotKey)
            entries = tree.entries
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func fork(entryId: String) async {
        forking = entryId
        defer { forking = nil }
        do {
            let resp = try await appState.apiClient.forkSlot(slot: slotKey, entryId: entryId)
            if resp.cancelled == true {
                cancelledAlert = true
                HapticManager.error()
                return
            }
            guard resp.ok, let newKey = resp.newSlotKey else {
                self.error = "Fork failed — server did not return a new slot"
                HapticManager.error()
                return
            }
            HapticManager.messageSent()
            await appState.loadSlots()
            appState.selectedSlotKey = newKey
            dismiss()
        } catch {
            self.error = error.localizedDescription
            HapticManager.error()
        }
    }
}
