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
    let onSend: () -> Void
    let onStop: () -> Void
    @FocusState private var isFocused: Bool

    @State private var showPhotoPicker = false
    @State private var showDocumentPicker = false
    @State private var photoSelection: [PhotosPickerItem] = []

    private var canSend: Bool {
        !isStreaming && !isDisabled &&
        (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !pendingImages.isEmpty)
    }

    var body: some View {
        VStack(spacing: 8) {
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
                                        .font(.system(size: 18))
                                        .foregroundStyle(.white)
                                        .background(Circle().fill(.black.opacity(0.5)))
                                }
                                .offset(x: 6, y: -6)
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                }
                .padding(.top, 6)
            }

            HStack(alignment: .bottom, spacing: 8) {
                // Attachment button
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
                        // Camera
                        showCamera()
                    } label: {
                        Label("Take Photo", systemImage: "camera")
                    }
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 26))
                        .foregroundStyle(Color.accentColor)
                }

                TextField("Message", text: $text, axis: .vertical)
                    .lineLimit(1...6)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .fill(Color(.systemGray6))
                    )
                    .submitLabel(.send)
                    .disabled(isDisabled)
                    .focused($isFocused)
                    .onSubmit {
                        if canSend {
                            isFocused = false
                            onSend()
                        }
                    }

                Button(action: {
                    if isStreaming {
                        onStop()
                    } else {
                        isFocused = false
                        onSend()
                    }
                }) {
                    Image(systemName: isStreaming ? "stop.circle.fill" : "arrow.up.circle.fill")
                        .font(.system(size: 30))
                        .foregroundStyle(
                            isStreaming ? Color.red
                                : (canSend ? Color.accentColor : Color.secondary)
                        )
                        .contentTransition(.symbolEffect(.replace))
                        .animation(.spring(duration: 0.3), value: isStreaming)
                }
                .disabled(!isStreaming && !canSend)
            }
            .padding(.horizontal, 12)
        }
        .padding(.vertical, 10)
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
    }

    private func loadPhotos(_ items: [PhotosPickerItem]) async {
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self) {
                if let uiImage = UIImage(data: data) {
                    // Compress to JPEG for reasonable size
                    let jpeg = uiImage.jpegData(compressionQuality: 0.8) ?? data
                    let thumb = uiImage.preparingThumbnail(of: CGSize(width: 120, height: 120)) ?? uiImage
                    let pending = PendingImage(data: jpeg, mimeType: "image/jpeg", thumbnail: thumb)
                    await MainActor.run { pendingImages.append(pending) }
                }
            }
        }
        await MainActor.run { photoSelection = [] }
    }

    private func showCamera() {
        // Camera requires UIKit — handled via DocumentPicker/ImagePicker
        // For now, photo library is the primary path
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
                        // Non-image file — create a placeholder thumbnail
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
