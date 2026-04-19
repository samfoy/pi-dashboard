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
    var isDisabled: Bool = false
    var contextPercent: Double? = nil
    var lastAssistantContent: String? = nil
    var onShowPalette: (() -> Void)? = nil
    var onShowModelPicker: (() -> Void)? = nil
    var onCompact: (() -> Void)? = nil
    var onHealthSummary: (() -> Void)? = nil
    var onCalendarSummary: (() -> Void)? = nil
    var onRemindersSummary: (() -> Void)? = nil
    let onSend: () -> Void
    let onStop: () -> Void
    @FocusState private var isFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var showPhotoPicker = false
    @State private var showDocumentPicker = false
    @State private var showCamera = false
    @State private var photoSelection: [PhotosPickerItem] = []
    @State private var showCompactConfirm = false

    private var canSend: Bool {
        !isStreaming && !isDisabled &&
        (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !pendingImages.isEmpty)
    }

    var body: some View {
        VStack(spacing: 0) {
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
                                .fill(Color(.systemGray5))
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
                            .fill(Color(.systemGray6))
                    )
                    .submitLabel(.return)
                    .disabled(isDisabled)
                    .focused($isFocused)

                Button(action: {
                    if isStreaming {
                        onStop()
                    } else {
                        isFocused = false
                        onSend()
                    }
                }) {
                    Image(systemName: isStreaming ? "stop.circle.fill" : "arrow.up.circle.fill")
                        .font(.title)
                        .foregroundStyle(
                            isStreaming ? Color.red
                                : (canSend ? Color.accentColor : Color.secondary)
                        )
                        .contentTransition(.symbolEffect(.replace))
                        .animation(reduceMotion ? nil : .spring(duration: 0.3), value: isStreaming)
                }
                .disabled(!isStreaming && !canSend)
                .scaleEffect(canSend || isStreaming ? 1.0 : 0.82)
                .animation(reduceMotion ? nil : .spring(response: 0.25, dampingFraction: 0.6), value: canSend)
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 10)
            .padding(.top, 4)
        }
        .background(.bar)
        .photosPicker(isPresented: $showPhotoPicker, selection: $photoSelection, maxSelectionCount: 5, matching: .images)
        .onChange(of: photoSelection) { _, items in
            Task { await loadPhotos(items) }
        }
        .sheet(isPresented: $showDocumentPicker) {
            DocumentPicker { images in
                pendingImages.append(contentsOf: images)
            }
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
                    .fill(Color(.systemGray5))
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
    let onPick: ([PendingImage]) -> Void

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.image, .pdf, .plainText, .data])
        picker.allowsMultipleSelection = true
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onPick: onPick) }

    class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onPick: ([PendingImage]) -> Void
        init(onPick: @escaping ([PendingImage]) -> Void) { self.onPick = onPick }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            var images: [PendingImage] = []
            for url in urls {
                guard url.startAccessingSecurityScopedResource() else { continue }
                defer { url.stopAccessingSecurityScopedResource() }

                if let data = try? Data(contentsOf: url) {
                    let mimeType = url.pathExtension.lowercased() == "png" ? "image/png" : "image/jpeg"
                    if let uiImage = UIImage(data: data) {
                        let thumb = uiImage.preparingThumbnail(of: CGSize(width: 120, height: 120)) ?? uiImage
                        images.append(PendingImage(data: data, mimeType: mimeType, thumbnail: thumb))
                    } else {
                        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 120, height: 120))
                        let placeholder = renderer.image { ctx in
                            UIColor.systemGray5.setFill()
                            ctx.fill(CGRect(x: 0, y: 0, width: 120, height: 120))
                            let icon = "📄"
                            let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 40)]
                            icon.draw(at: CGPoint(x: 35, y: 30), withAttributes: attrs)
                        }
                        images.append(PendingImage(data: data, mimeType: "application/octet-stream", thumbnail: placeholder))
                    }
                }
            }
            onPick(images)
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
