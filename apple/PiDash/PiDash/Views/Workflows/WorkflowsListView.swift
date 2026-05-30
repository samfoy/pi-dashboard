import SwiftUI

// MARK: - WorkflowsListView

struct WorkflowsListView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel: WorkflowsViewModel?
    @State private var selectedRun: WorkflowRun?
    @State private var showDetail = false

    var body: some View {
        Group {
            if let vm = viewModel {
                WorkflowsContent(
                    viewModel: vm,
                    selectedRun: $selectedRun
                )
            } else {
                ProgressView()
                    .onAppear {
                        viewModel = WorkflowsViewModel(apiClient: appState.apiClient)
                        viewModel?.start()
                    }
            }
        }
        .onDisappear { viewModel?.stop() }
    }
}

// MARK: - WorkflowsContent

private struct WorkflowsContent: View {
    @Bindable var viewModel: WorkflowsViewModel
    @Binding var selectedRun: WorkflowRun?

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading && viewModel.runs.isEmpty {
                    ProgressView("Loading workflows…")
                } else if let err = viewModel.error, viewModel.runs.isEmpty {
                    ContentUnavailableView {
                        Label("Could not load workflows", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(err)
                    } actions: {
                        Button("Retry") { Task { await viewModel.load() } }
                    }
                } else if viewModel.runs.isEmpty {
                    ContentUnavailableView {
                        Label("No workflow runs yet", systemImage: "gearshape.2")
                    } description: {
                        Text("Start a workflow with /codebase-audit or another command in any chat.")
                    }
                } else {
                    runsList
                }
            }
            .navigationTitle("Workflows")
            .toolbar { toolbarItems }
            .refreshable { await viewModel.load() }
        }
    }

    // MARK: Runs list

    private var runsList: some View {
        List {
            let active = viewModel.runs.filter { $0.state.isActive }
            let terminal = viewModel.runs.filter { $0.state.isTerminal }

            if !active.isEmpty {
                Section("Active") {
                    ForEach(active) { run in
                        runRow(run)
                    }
                }
            }

            if !terminal.isEmpty {
                Section("Recent") {
                    ForEach(terminal) { run in
                        runRow(run)
                    }
                    .onDelete { offsets in
                        let items = offsets.map { terminal[$0] }
                        Task {
                            for item in items {
                                await viewModel.deleteRun(item)
                            }
                        }
                    }
                }
            }
        }
    }

    private func runRow(_ run: WorkflowRun) -> some View {
        NavigationLink(destination: WorkflowRunDetailView(run: run)) {
            WorkflowRunRow(run: run)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if run.state.isTerminal {
                Button(role: .destructive) {
                    Task { await viewModel.deleteRun(run) }
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbarItems: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button {
                Task { await viewModel.load() }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
        }
    }
}

// MARK: - WorkflowRunRow

struct WorkflowRunRow: View {
    let run: WorkflowRun

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: run.state.systemImage)
                    .foregroundStyle(run.state.stateColor)
                    .frame(width: 18)

                Text(run.workflowName)
                    .font(.headline)
                    .lineLimit(1)

                Spacer()

                Text(run.state.displayLabel)
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(run.state.stateColor.opacity(0.12))
                    .foregroundStyle(run.state.stateColor)
                    .clipShape(Capsule())
            }

            HStack(spacing: 12) {
                if let input = run.input, !input.isEmpty {
                    Label(input.prefix(40) + (input.count > 40 ? "…" : ""), systemImage: "text.cursor")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer()

                if let count = run.agentCount, count > 0 {
                    Label("\(count)", systemImage: "person.2")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Label(run.durationLabel, systemImage: "clock")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let cwd = run.cwd {
                Text(compactPath(cwd))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }

    private func compactPath(_ path: String) -> String {
        let home = NSHomeDirectory()
        return path.hasPrefix(home) ? "~" + path.dropFirst(home.count) : path
    }
}
