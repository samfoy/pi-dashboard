import SwiftUI

// MARK: - InlineImageView

/// Renders an image from a server URL with tap-to-fullscreen and long-press-to-save.
/// Used in assistant messages and tool results for images served via /api/local-file.
struct InlineImageView: View {
    let url: URL
    @State private var showFullscreen = false
    @State private var uiImage: UIImage?
    @State private var isLoading = true
    @State private var failed = false
    @State private var savedToPhotos = false
    @State private var showFileSaver = false
    @State private var tempFileURL: URL?

    var body: some View {
        Group {
            if let uiImage {
                Image(uiImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(maxWidth: 300, maxHeight: 400)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .onTapGesture { showFullscreen = true }
                    .contextMenu {
                        Button {
                            UIImageWriteToSavedPhotosAlbum(uiImage, nil, nil, nil)
                            savedToPhotos = true
                            HapticManager.messageSent()
                        } label: {
                            Label("Save to Photos", systemImage: "square.and.arrow.down")
                        }
                        Button {
                            UIPasteboard.general.image = uiImage
                            HapticManager.messageSent()
                        } label: {
                            Label("Copy Image", systemImage: "doc.on.doc")
                        }
                        Button {
                            saveImageToFiles(uiImage)
                        } label: {
                            Label("Save to Files", systemImage: "folder.badge.plus")
                        }
                        ShareLink(item: Image(uiImage: uiImage), preview: SharePreview("Image", image: Image(uiImage: uiImage))) {
                            Label("Share", systemImage: "square.and.arrow.up")
                        }
                    }
                    .overlay(alignment: .bottomTrailing) {
                        if savedToPhotos {
                            Text("Saved ✓")
                                .font(.caption2.bold())
                                .foregroundStyle(.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.green.opacity(0.9))
                                .clipShape(Capsule())
                                .padding(8)
                                .transition(.scale.combined(with: .opacity))
                                .onAppear {
                                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                        withAnimation { savedToPhotos = false }
                                    }
                                }
                        }
                    }
            } else if isLoading {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color(.systemGray5))
                    .frame(width: 200, height: 150)
                    .overlay {
                        ProgressView()
                    }
            } else if failed {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color(.systemGray5))
                    .frame(width: 200, height: 80)
                    .overlay {
                        VStack(spacing: 4) {
                            Image(systemName: "photo.badge.exclamationmark")
                                .font(.title3)
                                .foregroundStyle(.secondary)
                            Text("Failed to load")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
            }
        }
        .task { await loadImage() }
        .sheet(isPresented: $showFileSaver) {
            if let url = tempFileURL {
                DocumentExportPicker(url: url)
            }
        }
        .fullScreenCover(isPresented: $showFullscreen) {
            if let uiImage {
                FullscreenImageView(image: uiImage)
            }
        }
    }

    private func saveImageToFiles(_ image: UIImage) {
        let fileName = "image_\(Int(Date().timeIntervalSince1970)).png"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        if let data = image.pngData() {
            try? data.write(to: url)
            tempFileURL = url
            showFileSaver = true
        }
    }

    private func loadImage() async {
        isLoading = true
        failed = false
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let image = UIImage(data: data) else {
                failed = true
                isLoading = false
                return
            }
            uiImage = image
        } catch {
            failed = true
        }
        isLoading = false
    }
}

// MARK: - DocumentExportPicker

/// UIDocumentPickerViewController wrapper for exporting a file to the Files app.
private struct DocumentExportPicker: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        UIDocumentPickerViewController(forExporting: [url], asCopy: true)
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}
}

// MARK: - FullscreenImageView

/// iMessage-style fullscreen image viewer with pinch-to-zoom.
private struct FullscreenImageView: View {
    let image: UIImage
    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var savedToPhotos = false

    var body: some View {
        NavigationStack {
            GeometryReader { geo in
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .scaleEffect(scale)
                    .offset(offset)
                    .frame(width: geo.size.width, height: geo.size.height)
                    .gesture(
                        MagnificationGesture()
                            .onChanged { value in
                                scale = lastScale * value
                            }
                            .onEnded { value in
                                lastScale = scale
                                if scale < 1.0 {
                                    withAnimation(.spring(duration: 0.3)) {
                                        scale = 1.0
                                        lastScale = 1.0
                                        offset = .zero
                                    }
                                }
                            }
                    )
                    .simultaneousGesture(
                        DragGesture()
                            .onChanged { value in
                                if scale > 1.0 {
                                    offset = value.translation
                                }
                            }
                            .onEnded { _ in
                                if scale <= 1.0 {
                                    withAnimation(.spring(duration: 0.3)) {
                                        offset = .zero
                                    }
                                }
                            }
                    )
                    .onTapGesture(count: 2) {
                        withAnimation(.spring(duration: 0.3)) {
                            if scale > 1.0 {
                                scale = 1.0
                                lastScale = 1.0
                                offset = .zero
                            } else {
                                scale = 3.0
                                lastScale = 3.0
                            }
                        }
                    }
            }
            .background(Color.black)
            .ignoresSafeArea()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(.white)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 16) {
                        ShareLink(item: Image(uiImage: image), preview: SharePreview("Image", image: Image(uiImage: image))) {
                            Image(systemName: "square.and.arrow.up")
                                .foregroundStyle(.white)
                        }
                        Button {
                            UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
                            savedToPhotos = true
                            HapticManager.messageSent()
                            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                savedToPhotos = false
                            }
                        } label: {
                            Image(systemName: savedToPhotos ? "checkmark.circle.fill" : "arrow.down.circle")
                                .foregroundStyle(savedToPhotos ? .green : .white)
                        }
                    }
                }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
        }
    }
}
