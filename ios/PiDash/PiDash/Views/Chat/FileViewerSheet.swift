import SwiftUI
import MarkdownUI
import Highlightr
import UIKit

// MARK: - ViewerTab

enum ViewerTab: String, CaseIterable {
    case content = "Content"
    case versions = "Versions"
}

// MARK: - FileViewerViewModel

@Observable
final class FileViewerViewModel {
    var content: String = ""
    var isLoading: Bool = false
    var error: String? = nil

    // Version history
    var versions: [FileVersion] = [FileVersion]()
    var versionsLoading: Bool = false
    var versionContent: String? = nil
    var versionError: String? = nil
    var selectedVersion: FileVersion? = nil

    let path: String
    private let apiClient: APIClient

    init(path: String, apiClient: APIClient) {
        self.path = path
        self.apiClient = apiClient
    }

    func load() async {
        guard content.isEmpty && !isLoading else { return }
        isLoading = true
        error = nil
        do {
            content = try await apiClient.readFile(path: path)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func loadVersions() async {
        guard versions.isEmpty && !versionsLoading else { return }
        versionsLoading = true
        versionError = nil
        do {
            versions = try await apiClient.getFileVersions(path: path)
        } catch {
            versionError = error.localizedDescription
        }
        versionsLoading = false
    }

    func loadVersion(_ v: FileVersion) async {
        versionsLoading = true
        versionError = nil
        selectedVersion = v
        do {
            versionContent = try await apiClient.getFileVersion(path: path, version: v.version)
        } catch {
            versionError = error.localizedDescription
        }
        versionsLoading = false
    }
}

// MARK: - FileViewerSheet

struct FileViewerSheet: View {
    let path: String

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState

    @State private var viewModel: FileViewerViewModel
    @State private var selectedTab: ViewerTab = .content
    @State private var isSharePresented = false
    @State private var shareURL: URL? = nil
    @State private var showCopiedFeedback = false

    init(path: String) {
        self.path = path
        // ViewModel will be re-initialized once the environment is available;
        // use a temporary placeholder — will be replaced in .task on first appear.
        // We use a separate init trick: store the path and defer real VM creation.
        // Since @Observable can't be initialized with @Environment values here,
        // we create a dummy VM and replace it in onAppear via a separate state bool.
        self._viewModel = State(wrappedValue: FileViewerViewModel(
            path: path,
            apiClient: APIClient()
        ))
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("View", selection: $selectedTab) {
                    ForEach(ViewerTab.allCases, id: \.self) { tab in
                        Text(tab.rawValue).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.vertical, 8)
                .background(Color(.systemGroupedBackground))

                Divider()

                switch selectedTab {
                case .content:
                    FileViewerContent(viewModel: viewModel)
                case .versions:
                    FileVersionsView(viewModel: viewModel)
                }
            }
            .navigationTitle((path as NSString).lastPathComponent)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                    ToolbarItemGroup(placement: .topBarLeading) {
                        Button {
                            copyContent()
                        } label: {
                            Image(systemName: showCopiedFeedback ? "checkmark" : "doc.on.doc")
                        }
                        .disabled(viewModel.content.isEmpty)
                        .animation(.easeInOut(duration: 0.2), value: showCopiedFeedback)

                        Button {
                            prepareShare()
                        } label: {
                            Image(systemName: "square.and.arrow.up")
                        }
                        .disabled(viewModel.content.isEmpty)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
        }
        .task {
            // Replace the placeholder VM with one using the real APIClient from env
            let realVM = FileViewerViewModel(path: path, apiClient: appState.apiClient)
            viewModel = realVM
            await realVM.load()
        }
        .sheet(isPresented: $isSharePresented) {
            if let url = shareURL {
                ShareSheet(activityItems: [url])
            }
        }
    }

    // MARK: - Share helpers

    private func copyContent() {
        UIPasteboard.general.string = viewModel.content
        showCopiedFeedback = true
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            showCopiedFeedback = false
        }
    }

    private func prepareShare() {
        let filename = (path as NSString).lastPathComponent
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        do {
            try viewModel.content.write(to: tempURL, atomically: true, encoding: .utf8)
            shareURL = tempURL
            isSharePresented = true
        } catch {
            // Fallback: share plain text string directly via a separate UIActivityViewController
            shareURL = nil
            let av = UIActivityViewController(activityItems: [viewModel.content], applicationActivities: nil)
            if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
               let root = scene.windows.first?.rootViewController {
                root.present(av, animated: true)
            }
        }
    }
}

// MARK: - FileViewerContent

struct FileViewerContent: View {
    let viewModel: FileViewerViewModel

    private var fileExtension: String {
        (viewModel.path as NSString).pathExtension.lowercased()
    }
    private var isMarkdown: Bool {
        fileExtension == "md" || fileExtension == "markdown"
    }
    private var isImage: Bool {
        ["png", "jpg", "jpeg", "gif", "webp", "svg"].contains(fileExtension)
    }

    var body: some View {
        Group {
            if viewModel.isLoading {
                loadingView
            } else if let err = viewModel.error {
                errorView(message: err)
            } else if viewModel.content.isEmpty {
                loadingView
            } else if isMarkdown {
                markdownView
            } else if isImage {
                imageView
            } else {
                codeView
            }
        }
    }

    // MARK: Loading

    private var loadingView: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text("Loading…")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Error

    private func errorView(message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
            Text("Could not load file")
                .font(.headline)
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Markdown

    private var markdownView: some View {
        ScrollView {
            Markdown(viewModel.content)
                .markdownTheme(.piDash)
                .padding()
        }
    }

    // MARK: Image

    private var imageView: some View {
        ScrollView {
            AsyncImage(url: imageURL) { phase in
                switch phase {
                case .empty:
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 200)
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFit()
                        .padding()
                case .failure:
                    VStack(spacing: 8) {
                        Image(systemName: "photo.badge.exclamationmark")
                            .font(.system(size: 40))
                            .foregroundStyle(.secondary)
                        Text("Could not render image")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 200)
                @unknown default:
                    EmptyView()
                }
            }
        }
    }

    private var imageURL: URL? {
        guard let base = UserDefaults.standard.string(forKey: "serverURL"),
              var components = URLComponents(string: base) else { return nil }
        components.path = "/api/local-file"
        components.queryItems = [URLQueryItem(name: "path", value: viewModel.path)]
        return components.url
    }

    // MARK: Code / Plain text

    private var codeView: some View {
        HighlightedCodeView(
            code: viewModel.content,
            language: fileExtension
        )
    }
}

// MARK: - HighlightedCodeView

struct HighlightedCodeView: View {
    let code: String
    let language: String

    @State private var attributed: AttributedString? = nil

    var body: some View {
        ScrollView([.horizontal, .vertical]) {
            Group {
                if let attributed {
                    Text(attributed)
                        .font(.system(.caption, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text(code)
                        .font(.system(.caption, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding()
        }
        .background(Color(.systemGray6))
        .task(id: code) {
            attributed = await highlight(code: code, language: language)
        }
    }

    private func highlight(code: String, language: String) async -> AttributedString? {
        await Task.detached(priority: .userInitiated) {
            guard let highlightr = Highlightr() else { return nil }
            let theme = UITraitCollection.current.userInterfaceStyle == .dark
                ? "atom-one-dark"
                : "xcode"
            highlightr.setTheme(to: theme)
            guard let nsAttr = highlightr.highlight(code, as: language.isEmpty ? nil : language)
            else { return nil }
            return try? AttributedString(nsAttr, including: \.uiKit)
        }.value
    }
}

// MARK: - FileVersionsView

struct FileVersionsView: View {
    let viewModel: FileViewerViewModel

    @State private var showDiff: Bool = false

    var body: some View {
        Group {
            if viewModel.versionsLoading && viewModel.versions.isEmpty {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = viewModel.versionError, viewModel.versions.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 32))
                        .foregroundStyle(.secondary)
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if viewModel.versions.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "clock.badge.xmark")
                        .font(.system(size: 32))
                        .foregroundStyle(.secondary)
                    Text("No version history")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(viewModel.versions) { version in
                    Button {
                        Task { await viewModel.loadVersion(version) }
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Version \(version.version)")
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                    .foregroundStyle(.primary)
                                Text(version.formattedDate)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text("\(version.size) bytes")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                            Spacer()
                            if viewModel.versionsLoading && viewModel.selectedVersion?.version == version.version {
                                ProgressView()
                                    .scaleEffect(0.8)
                            } else {
                                Image(systemName: "doc.text.magnifyingglass")
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    .buttonStyle(.plain)
                }
                .listStyle(.plain)
            }
        }
        .task {
            await viewModel.loadVersions()
        }
        .onChange(of: viewModel.versionContent) { _, newValue in
            showDiff = newValue != nil
        }
        .sheet(isPresented: $showDiff, onDismiss: {
            viewModel.versionContent = nil
            viewModel.selectedVersion = nil
        }) {
            NavigationStack {
                if let vc = viewModel.versionContent {
                    LineDiffView(old: viewModel.content, new: vc)
                        .navigationTitle("v\(viewModel.selectedVersion?.version ?? 0) diff")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Done") { showDiff = false }
                            }
                        }
                } else {
                    ProgressView()
                }
            }
        }
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let activityItems: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
