import SwiftUI
import WebKit
import PhotosUI
import UniformTypeIdentifiers

// MARK: - NoAccessoryWebView

/// Suppresses the iOS keyboard accessory bar (↑ ↓ ✓ row above keyboard).
final class NoAccessoryWebView: WKWebView {
    override var inputAccessoryView: UIView? { nil }
}

struct WebView: UIViewRepresentable {
    @Environment(AppState.self) var appState

    func makeUIView(context: Context) -> NoAccessoryWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let handlers = ["piHaptic", "piSetActiveSlot", "piOpenShare",
                        "piOpenInSafari", "piRequestNotificationPermission", "piReady",
                        "piPickMedia", "piPickFile"]
        for name in handlers {
            config.userContentController.add(context.coordinator, name: name)
        }

        let webView = NoAccessoryWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) PiDash-iOS/1.0"

        // Left-edge back swipe — invokes window.history.back() in the web view.
        let edgePan = UIScreenEdgePanGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleEdgeSwipe(_:))
        )
        edgePan.edges = .left
        webView.addGestureRecognizer(edgePan)

        context.coordinator.webView = webView
        loadURL(in: webView)
        return webView
    }

    func updateUIView(_ webView: NoAccessoryWebView, context: Context) {
        // Pending deep links / notification actions dispatched by Coordinator after piReady
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(appState: appState)
    }

    func loadURL(in webView: WKWebView) {
        let base = appState.serverConfig.baseURL
        let token = appState.serverConfig.token
        guard !base.isEmpty, var components = URLComponents(string: base) else { return }
        components.path = "/"
        if !token.isEmpty {
            var items = components.queryItems ?? []
            items.append(URLQueryItem(name: "token", value: token))
            components.queryItems = items
        }
        guard let url = components.url else { return }
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        webView.load(request)
    }

    // MARK: - Coordinator

    @MainActor
    class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKUIDelegate, PHPickerViewControllerDelegate, UIDocumentPickerDelegate {
        let appState: AppState
        weak var webView: NoAccessoryWebView?
        private var readyFired = false

        init(appState: AppState) {
            self.appState = appState
        }

        // MARK: JS → Native

        func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
            let body = message.body as? [String: Any] ?? [:]
            switch message.name {
            case "piHaptic":
                handleHaptic(body)
            case "piSetActiveSlot":
                appState.notificationService.activeSlotKey = body["slotKey"] as? String
            case "piOpenShare":
                handleShare(body)
            case "piOpenInSafari":
                if let urlStr = body["url"] as? String, let url = URL(string: urlStr) {
                    UIApplication.shared.open(url)
                }
            case "piRequestNotificationPermission":
                Task { await appState.notificationService.requestPermission() }
            case "piReady":
                readyFired = true
                dispatchPending()
            case "piPickMedia":
                handlePickMedia()
            case "piPickFile":
                handlePickFile()
            default:
                break
            }
        }

        // MARK: Pickers

        private func handlePickMedia() {
            var config = PHPickerConfiguration()
            config.selectionLimit = 5
            config.filter = .any(of: [.images])
            let picker = PHPickerViewController(configuration: config)
            picker.delegate = self
            present(picker)
        }

        private func handlePickFile() {
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.data, .text, .pdf])
            picker.allowsMultipleSelection = true
            picker.delegate = self
            present(picker)
        }

        private func present(_ vc: UIViewController) {
            DispatchQueue.main.async {
                guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                      let root = scene.windows.first?.rootViewController else { return }
                // Walk to the topmost presented controller so we don't try to present
                // on a controller that's already presenting something.
                var top: UIViewController = root
                while let presented = top.presentedViewController { top = presented }
                top.present(vc, animated: true)
            }
        }

        // MARK: Edge swipe

        @objc func handleEdgeSwipe(_ recognizer: UIScreenEdgePanGestureRecognizer) {
            guard recognizer.state == .recognized else { return }
            dispatch("open-sidebar")
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }

        private func handleHaptic(_ body: [String: Any]) {
            switch body["style"] as? String ?? "light" {
            case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
            case "error":   UINotificationFeedbackGenerator().notificationOccurred(.error)
            case "heavy":   UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
            case "medium":  UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            default:        UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
        }

        private func handleShare(_ body: [String: Any]) {
            let text = body["text"] as? String ?? ""
            let urlStr = body["url"] as? String
            var items: [Any] = [text]
            if let u = urlStr.flatMap(URL.init) { items.append(u) }
            let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
            present(vc)
        }

        // MARK: Native → JS

        func dispatch(_ type: String, payload: [String: Any] = [:]) {
            guard let wv = webView else { return }
            var merged = payload
            merged["type"] = type
            guard let data = try? JSONSerialization.data(withJSONObject: merged),
                  let json = String(data: data, encoding: .utf8) else { return }
            let js = "window.dispatchEvent(new CustomEvent('pi-native', { detail: \(json) }))"
            DispatchQueue.main.async { wv.evaluateJavaScript(js, completionHandler: nil) }
        }

        private func dispatchPending() {
            if let key = appState.pendingDeepLinkKey {
                dispatch("navigate-slot", payload: ["slotKey": key])
                appState.pendingDeepLinkKey = nil
            }
            if let action = appState.pendingNotificationAction {
                switch action {
                case .navigateToSlot(let k): dispatch("navigate-slot",  payload: ["slotKey": k])
                case .stopSlot(let k):       dispatch("stop-slot",      payload: ["slotKey": k])
                case .approveSlot(let k):    dispatch("approve-slot",   payload: ["slotKey": k])
                case .rejectSlot(let k):     dispatch("reject-slot",    payload: ["slotKey": k])
                }
                appState.pendingNotificationAction = nil
            }
        }

        // MARK: PHPickerViewControllerDelegate

        nonisolated func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            picker.dismiss(animated: true)
            for result in results {
                result.itemProvider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { [weak self] data, _ in
                    guard let self, let data else { return }
                    let mimeType = result.itemProvider.registeredContentTypes.first?.preferredMIMEType ?? "image/jpeg"
                    let base64 = data.base64EncodedString()
                    let dataURL = "data:\(mimeType);base64,\(base64)"
                    DispatchQueue.main.async {
                        self.dispatch("media-picked", payload: ["data": base64, "mimeType": mimeType, "preview": dataURL])
                    }
                }
            }
        }

        // MARK: UIDocumentPickerDelegate

        nonisolated func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            for url in urls {
                guard url.startAccessingSecurityScopedResource() else { continue }
                defer { url.stopAccessingSecurityScopedResource() }
                guard let data = try? Data(contentsOf: url) else { continue }
                let base64 = data.base64EncodedString()
                let mimeType = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                DispatchQueue.main.async {
                    self.dispatch("file-picked", payload: [
                        "name": url.lastPathComponent,
                        "data": base64,
                        "mimeType": mimeType
                    ])
                }
            }
        }

        // MARK: WKNavigationDelegate

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            appState.connectionFailed = false
            if readyFired { dispatchPending() }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError error: Error) {
            appState.connectionFailed = true
        }

        func webView(_ webView: WKWebView,
                     decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.allow); return }
            let serverHost = URL(string: appState.serverConfig.baseURL)?.host
            if url.scheme == "pidash" || url.host == serverHost {
                decisionHandler(.allow)
            } else if url.scheme == "http" || url.scheme == "https" {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
        }
    }
}
