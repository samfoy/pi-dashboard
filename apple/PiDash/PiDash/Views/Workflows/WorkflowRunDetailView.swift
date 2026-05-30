import SwiftUI

// MARK: - WorkflowRunDetailView

struct WorkflowRunDetailView: View {
    let run: WorkflowRun

    @Environment(AppState.self) private var appState
    @State private var detail: WorkflowRunDetail?
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        Group {
            if isLoading {
                ProgressView("Loading…")
            } else if let err = error {
                ContentUnavailableView {
                    Label("Failed to load", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(err)
                } actions: {
                    Button("Retry") { Task { await load() } }
                }
            } else if let detail {
                detailContent(detail)
            }
        }
        .navigationTitle(run.workflowName)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    // MARK: Load

    private func load() async {
        isLoading = true
        error = nil
        do {
            detail = try await appState.apiClient.fetchWorkflowRunDetail(runId: run.runId)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    // MARK: Content

    @ViewBuilder
    private func detailContent(_ detail: WorkflowRunDetail) -> some View {
        List {
            // ── Header ───────────────────────────────────────────────
            Section {
                RunHeaderCard(run: detail.asSummary)
            }

            // ── Metadata ─────────────────────────────────────────────
            Section("Info") {
                if let cwd = detail.cwd {
                    LabeledContent("Working directory") {
                        Text(compactPath(cwd))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.trailing)
                    }
                }
                if let input = detail.input, !input.isEmpty {
                    LabeledContent("Input") {
                        Text(input)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.trailing)
                    }
                }
                if let agents = detail.agentCount {
                    LabeledContent("Agents", value: "\(agents)")
                }
                if let ts = detail.tokenSummary {
                    LabeledContent("Tokens") {
                        Text("in: \(TokenSummary.format(ts.totalInput)) · out: \(TokenSummary.format(ts.totalOutput)) · cache: \(TokenSummary.format(ts.totalCacheRead))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.trailing)
                    }
                }
                if let ver = detail.piWorkflowsVersion {
                    LabeledContent("pi-workflows", value: ver)
                }
            }

            // ── Error ─────────────────────────────────────────────────
            if let err = detail.error {
                Section("Error") {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(err.name)
                            .font(.caption.bold())
                            .foregroundStyle(.red)
                        Text(err.message)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            }

            // ── Callback message ──────────────────────────────────────
            if let prompt = detail.finishCallbackPrompt, !prompt.isEmpty {
                Section("Completion message") {
                    Text(prompt)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            // ── Result ────────────────────────────────────────────────
            if let payload = detail.resultPayload {
                Section("Result") {
                    ScrollView(.horizontal) {
                        Text(payload.displayString)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.primary)
                            .padding(.vertical, 4)
                    }
                }
            }

            // ── Timeline ─────────────────────────────────────────────
            if !detail.timeline.isEmpty {
                Section("Timeline") {
                    ForEach(detail.timeline) { entry in
                        TimelineEntryRow(entry: entry)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func compactPath(_ path: String) -> String {
        let home = NSHomeDirectory()
        return path.hasPrefix(home) ? "~" + path.dropFirst(home.count) : path
    }
}

// MARK: - RunHeaderCard

private struct RunHeaderCard: View {
    let run: WorkflowRun

    var body: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(run.state.stateColor.opacity(0.12))
                    .frame(width: 52, height: 52)
                Image(systemName: run.state.systemImage)
                    .font(.title2)
                    .foregroundStyle(run.state.stateColor)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(run.state.displayLabel)
                    .font(.title3.bold())
                    .foregroundStyle(run.state.stateColor)
                HStack(spacing: 12) {
                    Label(run.relativeStartLabel, systemImage: "clock")
                    Label(run.durationLabel, systemImage: "timer")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - TimelineEntryRow

private struct TimelineEntryRow: View {
    let entry: LedgerEntry

    var entryColor: Color {
        switch entry.type {
        case "transition":
            if entry.to == "done" { return .green }
            if entry.to == "failed" { return .red }
            if entry.to == "running" { return .blue }
            if entry.to == "paused" { return .orange }
            return .secondary
        case "cancelled": return .orange
        case "phase_start", "phase_end": return .purple
        case "agent_start": return .blue.opacity(0.7)
        case "agent_end": return entry.cached == true ? .teal : .green.opacity(0.7)
        case "result": return .green
        case "init": return .secondary
        default: return .secondary
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(entryColor)
                .frame(width: 8, height: 8)
                .padding(.top, 4)

            VStack(alignment: .leading, spacing: 2) {
                Text(entry.displayLabel)
                    .font(.subheadline)

                // Token usage for agent_end
                if entry.type == "agent_end", let usage = entry.usage {
                    HStack(spacing: 8) {
                        if let input = usage.input, let output = usage.output {
                            Label("in: \(input)  out: \(output)", systemImage: "arrow.left.arrow.right")
                        }
                        if let total = usage.totalTokens {
                            Text("\(total) tokens")
                        }
                    }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                }

                Text(entry.timeLabel)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
    }
}
