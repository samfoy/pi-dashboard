import SwiftUI
import PhotosUI

// MARK: - Pending Image

struct PendingImage: Identifiable {
    let id = UUID()
    let data: Data
    let mimeType: String
    let thumbnail: UIImage

    var base64: String { data.base64EncodedString() }
}

// MARK: - ChatInputBar

struct ChatInputBar: View {
    @Binding var text: String
    @Binding var pendingImages: [PendingImage]
    let isStreaming: Bool
    var isStopping: Bool = false
    var isDisabled: Bool = false
    var contextPercent: Double? = nil
    var heartbeatStallMs: Int? = nil
    var lastAssistantContent: String? = nil
    var onShowPalette: (() -> Void)? = nil
    var onShowModelPicker: (() -> Void)? = nil
    var onCompact: (() -> Void)? = nil
    var onHealthSummary: (() -> Void)? = nil
    var onCalendarSummary: (() -> Void)? = nil
    var onRemindersSummary: (() -> Void)? = nil
    var onContactsSummary: (() -> Void)? = nil
    var onLocationSummary: (() -> Void)? = nil
    var onSpeechTap: (() -> Void)? = nil
    var isSpeechRecording: Bool = false
    /// Called when the user picks one or more files via `.fileImporter` for server upload.
    var onUploadFileURLs: (([URL]) -> Void)? = nil
    /// Called when the user picks non-image documents (PDF, text, etc.) via DocumentPicker.
    /// The data is pre-read within the security scope — pass to the server upload API.
    var onDocumentPickFiles: (([(name: String, data: Data)]) -> Void)? = nil
    /// When true, show a small progress indicator next to the input row.
    var isUploadingFiles: Bool = false
    let onSend: () -> Void
    let onStop: () -> Void
    @FocusState private var isFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.appTheme) private var theme

    @State private var showPhotoPicker = false
    @State private var showDocumentPicker = false
    @State private var showCamera = false
    @State private var showFileImporter = false
    @State private var photoSelection: [PhotosPickerItem] = []
    @State private var showCompactConfirm = false

    private var canSend: Bool {
        !isDisabled &&
        (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !pendingImages.isEmpty)
    }

    /// True when tapping the send button should queue a follow-up instead of starting a new turn.
    private var isQueuingFollowUp: Bool {
        isStreaming && canSend
    }

    private var heartbeatLabel: String? {
        guard isStreaming, let ms = heartbeatStallMs, ms > 0 else { return nil }
        let secs = ms / 1000
        if secs >= 60 {
            let mins = secs / 60
            return "still working\u{2026} (\(mins)m silent)"
        }
        return "still working\u{2026} (\(secs)s silent)"
    }

    var body: some View {
        VStack(spacing: 0) {
            // Heartbeat — pi is alive but silent
            if let label = heartbeatLabel {
                HStack(spacing: 6) {
                    ProgressView()
                        .controlSize(.mini)
                    Text(label)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.horizontal, 14)
                .padding(.top, 4)
                .transition(.opacity)
            }
            // Image thumbnails
            if !pendingImages.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(pendingImages) { img in
                            ZStack(alignment: .topTrailing) {
                                Image(uiImage: img.thumbnail)
                                    .resizable()
                                    .aspectRatio(contentMode: .fill)
                                    .frame(width: 60, height: 60)
                                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                                Button {
                                    withAnimation { pendingImages.removeAll { $0.id == img.id } }
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.body)
                                        .foregroundStyle(.white)
                                        .background(Circle().fill(.black.opacity(0.5)))
                                }
                                .offset(x: 6, y: -6)
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                }
                .padding(.top, 8)
                .padding(.bottom, 4)
            }

            // Quick action row
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 2) {
                    // Attach
                    Menu {
                        Button {
                            showPhotoPicker = true
                        } label: {
                            Label("Photo Library", systemImage: "photo.on.rectangle")
                        }
                        Button {
                            showDocumentPicker = true
                        } label: {
                            Label("Document", systemImage: "doc")
                        }
                        if onUploadFileURLs != nil {
                            Button {
                                showFileImporter = true
                            } label: {
                                Label("Upload File", systemImage: "paperclip.badge.ellipsis")
                            }
                        }
                        Button {
                            showCamera = true
                        } label: {
                            Label("Take Photo", systemImage: "camera")
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "paperclip")
                                .font(.caption2)
                            Text("Attach")
                                .font(.caption2)
                        }
                        .foregroundStyle(Color.secondary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(theme.cardBg)
                        )
                    }
                    // Command palette
                    if let onPalette = onShowPalette {
                        quickButton(icon: "bolt.fill", label: "Commands") { onPalette() }
                    }

                    // Model picker
                    if let onModel = onShowModelPicker {
                        quickButton(icon: "cpu", label: "Model") { onModel() }
                    }

                    // Compact — only when context > 50%
                    if let pct = contextPercent, pct > 0.5, let onCmpct = onCompact {
                        quickButton(
                            icon: "arrow.2.squarepath",
                            label: "Compact",
                            tint: pct > 0.8 ? .orange : nil
                        ) {
                            showCompactConfirm = true
                        }
                        .confirmationDialog(
                            "Compact conversation?",
                            isPresented: $showCompactConfirm,
                            titleVisibility: .visible
                        ) {
                            Button("Compact", role: .destructive) { onCmpct() }
                            Button("Cancel", role: .cancel) {}
                        } message: {
                            Text("Summarises the conversation to free up context (\(Int((pct * 100).rounded()))% used).")
                        }
                    }

                    // Health summary
                    if let onHealth = onHealthSummary {
                        quickButton(icon: "heart.fill", label: "Health", tint: .pink) { onHealth() }
                    }

                    // Calendar summary
                    if let onCal = onCalendarSummary {
                        quickButton(icon: "calendar", label: "Calendar", tint: .blue) { onCal() }
                    }

                    // Reminders summary
                    if let onReminders = onRemindersSummary {
                        quickButton(icon: "checklist", label: "Reminders", tint: .green) { onReminders() }
                    }

                    // Contacts summary
                    if let onContacts = onContactsSummary {
                        quickButton(icon: "person.2", label: "Contacts", tint: .orange) { onContacts() }
                    }

                    // Location summary
                    if let onLocation = onLocationSummary {
                        quickButton(icon: "location", label: "Location", tint: .blue) { onLocation() }
                    }

                    // Mic / speech
                    if let onSpeech = onSpeechTap {
                        quickButton(
                            icon: isSpeechRecording ? "mic.fill" : "mic",
                            label: isSpeechRecording ? "Stop" : "Mic",
                            tint: isSpeechRecording ? .red : .blue
                        ) { onSpeech() }
                    }

                    // Copy last assistant message
                    if let content = lastAssistantContent, !content.isEmpty {
                        quickButton(icon: "doc.on.doc", label: "Copy") {
                            UIPasteboard.general.string = content
                            HapticManager.messageSent()
                        }
                    }
                }
                .padding(.horizontal, 8)
            }
            .padding(.vertical, 4)

            // Input row
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Message", text: $text, axis: .vertical)
                    .lineLimit(1...6)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .fill(theme.inputBg)
                    )
                    .overlay(alignment: .trailing) {
                        if isUploadingFiles {
                            ProgressView()
                                .controlSize(.small)
                                .padding(.trailing, 10)
                        }
                    }
                    .submitLabel(.return)
                    .disabled(isDisabled)
                    .focused($isFocused)

                // Persistent stop button — always shown when streaming regardless of input text
                if isStreaming {
                    Button(action: { onStop() }) {
                        VStack(spacing: 2) {
                            Image(systemName: isStopping ? "stop.circle" : "stop.circle.fill")
                                .font(.title)
                                .foregroundStyle(isStopping ? theme.error.opacity(0.5) : theme.error)
                                .contentTransition(.symbolEffect(.replace))
                            if isStopping {
                                Text("Stopping")
                                    .font(.system(size: 9, weight: .medium))
                                    .foregroundStyle(theme.error.opacity(0.6))
                            }
                        }
                    }
                    .disabled(isStopping)
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: isStopping)
                }

                let sendIcon: String = {
                    if isQueuingFollowUp { return "arrow.up.circle.fill" }
                    return "arrow.up.circle.fill"
                }()
                let sendTint: Color = {
                    if isQueuingFollowUp { return theme.accent.opacity(0.85) }
                    return canSend ? theme.accent : theme.textSecondary
                }()
                Button(action: {
                    isFocused = false
                    onSend()
                }) {
                    sendButtonLabel(icon: sendIcon, tint: sendTint)
                }
                .disabled(!canSend)
                .scaleEffect(canSend ? 1.0 : 0.82)
                .animation(reduceMotion ? nil : .spring(response: 0.25, dampingFraction: 0.6), value: canSend)
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 10)
            .padding(.top, 4)
        }
        .background(.bar)
        .photosPicker(isPresented: $showPhotoPicker, selection: $photoSelection, maxSelectionCount: 5, matching: .images)
        .fileImporter(
            isPresented: $showFileImporter,
            allowedContentTypes: [.data],
            allowsMultipleSelection: true
        ) { result in
            switch result {
            case .success(let urls):
                onUploadFileURLs?(urls)
            case .failure:
                break
            }
        }
        .onChange(of: photoSelection) { _, items in
            Task { await loadPhotos(items) }
        }
        .sheet(isPresented: $showDocumentPicker) {
            DocumentPicker(
                onPickImages: { images in pendingImages.append(contentsOf: images) },
                onPickFiles: onDocumentPickFiles
            )
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                if let jpeg = image.jpegData(compressionQuality: 0.8) {
                    let thumb = image.preparingThumbnail(of: CGSize(width: 120, height: 120)) ?? image
                    pendingImages.append(PendingImage(data: jpeg, mimeType: "image/jpeg", thumbnail: thumb))
                }
            }
            .ignoresSafeArea()
        }
    }

    // MARK: - Send button label

    @ViewBuilder
    private func sendButtonLabel(icon: String, tint: Color) -> some View {
        let base = Image(systemName: icon)
            .font(.title)
            .foregroundStyle(tint)
            .contentTransition(.symbolEffect(.replace))
            .animation(reduceMotion ? nil : .spring(duration: 0.3), value: isStreaming)
        if isQueuingFollowUp {
            base.overlay(alignment: .topTrailing) {
                Image(systemName: "clock.fill")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(theme.pageBg)
                    .padding(2)
                    .background(Circle().fill(theme.accent))
                    .offset(x: 4, y: -4)
            }
        } else {
            base
        }
    }

    // MARK: - Quick action button

    private func quickButton(
        icon: String,
        label: String,
        tint: Color? = nil,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.caption2)
                Text(label)
                    .font(.caption2)
            }
            .foregroundStyle(tint ?? Color.secondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(theme.cardBg)
            )
        }
        .buttonStyle(.plain)
    }

    private func loadPhotos(_ items: [PhotosPickerItem]) async {
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self) {
                if let uiImage = UIImage(data: data) {
                    let jpeg = uiImage.jpegData(compressionQuality: 0.8) ?? data
                    let thumb = uiImage.preparingThumbnail(of: CGSize(width: 120, height: 120)) ?? uiImage
                    let pending = PendingImage(data: jpeg, mimeType: "image/jpeg", thumbnail: thumb)
                    await MainActor.run { pendingImages.append(pending) }
                }
            }
        }
        await MainActor.run { photoSelection = [] }
    }
}

// MARK: - Document Picker (UIKit bridge)

struct DocumentPicker: UIViewControllerRepresentable {
    /// Called with image files — added as inline vision attachments.
    let onPickImages: ([PendingImage]) -> Void
    /// Called with non-image files (PDF, text, etc.) — should be uploaded to the server.
    /// Receives (filename, raw data) tuples read within the security scope.
    var onPickFiles: (([(name: String, data: Data)]) -> Void)? = nil

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.image, .pdf, .plainText, .data])
        picker.allowsMultipleSelection = true
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onPickImages: onPickImages, onPickFiles: onPickFiles) }

    class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onPickImages: ([PendingImage]) -> Void
        let onPickFiles: (([(name: String, data: Data)]) -> Void)?

        init(
            onPickImages: @escaping ([PendingImage]) -> Void,
            onPickFiles: (([(name: String, data: Data)]) -> Void)? = nil
        ) {
            self.onPickImages = onPickImages
            self.onPickFiles = onPickFiles
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            var images: [PendingImage] = []
            var fileItems: [(name: String, data: Data)] = []

            for url in urls {
                guard url.startAccessingSecurityScopedResource() else { continue }
                defer { url.stopAccessingSecurityScopedResource() }

                guard let data = try? Data(contentsOf: url) else { continue }

                if let uiImage = UIImage(data: data) {
                    // Recognized image format — add as inline vision attachment
                    let mimeType = url.pathExtension.lowercased() == "png" ? "image/png" : "image/jpeg"
                    let thumb = uiImage.preparingThumbnail(of: CGSize(width: 120, height: 120)) ?? uiImage
                    images.append(PendingImage(data: data, mimeType: mimeType, thumbnail: thumb))
                } else {
                    // Non-image (PDF, text, etc.) — route to server upload, not vision API
                    fileItems.append((name: url.lastPathComponent, data: data))
                }
            }

            if !images.isEmpty { onPickImages(images) }
            if !fileItems.isEmpty { onPickFiles?(fileItems) }
        }
    }
}

// MARK: - Camera Picker (UIKit bridge)

struct CameraPicker: UIViewControllerRepresentable {
    let onCapture: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onCapture: onCapture, dismiss: dismiss) }

    class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onCapture: (UIImage) -> Void
        let dismiss: DismissAction

        init(onCapture: @escaping (UIImage) -> Void, dismiss: DismissAction) {
            self.onCapture = onCapture
            self.dismiss = dismiss
        }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage {
                onCapture(image)
            }
            dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            dismiss()
        }
    }
}
