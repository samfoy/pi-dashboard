import SwiftUI
import WebKit

struct WebView: UIViewRepresentable {
    @Environment(AppState.self) var appState

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let handlers = ["piHaptic", "piSetActiveSlot", "piOpenShare",
                        "piOpenInSafari", "piRequestNotificationPermission", "piReady"]
        for name in handlers {
            config.userContentController.add(context.coordinator, name: name)
        }

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) PiDash-iOS/1.0"

        context.coordinator.webView = webView
        loadURL(in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
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
    class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKUIDelegate {
        let appState: AppState
        weak var webView: WKWebView?
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
            default:
                break
            }
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
            DispatchQueue.main.async {
                guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                      let root = scene.windows.first?.rootViewController else { return }
                let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
                root.present(vc, animated: true)
            }
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
