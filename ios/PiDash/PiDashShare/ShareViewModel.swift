import Foundation
import UIKit
import MobileCoreServices
import UniformTypeIdentifiers

// MARK: - Supporting Types

enum ShareState: Equatable {
    case idle
    case loadingContent
    case loadingSlots
    case sending
    case success
    case error(String)
}

struct SlotInfo: Identifiable, Hashable {
    let id: String   // slot key, e.g. "chat-1-1713456000000"
    let title: String
}

enum SharedContent {
    case text(String)
    case url(URL)
    case image(UIImage)
    case file(name: String, data: Data)
}

// MARK: - ShareViewModel

@Observable
final class ShareViewModel {

    // MARK: Inputs
    var additionalMessage: String = ""
    var selectedSlotID: String? = nil   // nil = create new chat

    // MARK: State
    var state: ShareState = .loadingContent
    var sharedContent: SharedContent? = nil
    var availableSlots: [SlotInfo] = [SlotInfo]()

    // MARK: Private
    private let extensionContext: NSExtensionContext
    private let serverURL: String
    private let session: URLSession

    private static let appGroupSuite = "group.com.sam.pidash"
    private static let serverKey = "serverBaseURL"
    private static let defaultServer = "http://samuels-macbook-air-1.taile86245.ts.net:7777"

    init(extensionContext: NSExtensionContext) {
        self.extensionContext = extensionContext
        let defaults = UserDefaults(suiteName: Self.appGroupSuite) ?? .standard
        self.serverURL = defaults.string(forKey: Self.serverKey) ?? Self.defaultServer
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        self.session = URLSession(configuration: config)
    }

    // MARK: - Load Content

    func loadContent() async {
        state = .loadingContent
        guard let item = extensionContext.inputItems.first as? NSExtensionItem else {
            state = .error("No content to share.")
            return
        }
        let attachments = item.attachments ?? []

        // Try image first, then URL, then text, then file.
        if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }) {
            do {
                let loaded = try await provider.loadItem(forTypeIdentifier: UTType.image.identifier)
                if let img = loaded as? UIImage {
                    sharedContent = .image(img)
                } else if let url = loaded as? URL, let data = try? Data(contentsOf: url),
                          let img = UIImage(data: data) {
                    sharedContent = .image(img)
                } else if let data = loaded as? Data, let img = UIImage(data: data) {
                    sharedContent = .image(img)
                } else {
                    state = .error("Could not load image.")
                    return
                }
            } catch {
                state = .error("Image load failed: \(error.localizedDescription)")
                return
            }
        } else if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) {
            do {
                let loaded = try await provider.loadItem(forTypeIdentifier: UTType.url.identifier)
                if let url = loaded as? URL {
                    sharedContent = .url(url)
                } else {
                    state = .error("Could not load URL.")
                    return
                }
            } catch {
                state = .error("URL load failed: \(error.localizedDescription)")
                return
            }
        } else if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) {
            do {
                let loaded = try await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier)
                if let text = loaded as? String {
                    sharedContent = .text(text)
                } else {
                    state = .error("Could not load text.")
                    return
                }
            } catch {
                state = .error("Text load failed: \(error.localizedDescription)")
                return
            }
        } else if let provider = attachments.first {
            // Generic file fallback
            let typeIdentifier = provider.registeredTypeIdentifiers.first ?? UTType.data.identifier
            do {
                let loaded = try await provider.loadItem(forTypeIdentifier: typeIdentifier)
                if let url = loaded as? URL {
                    let data = try Data(contentsOf: url)
                    let name = url.lastPathComponent
                    if let img = UIImage(data: data) {
                        sharedContent = .image(img)
                    } else {
                        sharedContent = .file(name: name, data: data)
                    }
                } else {
                    state = .error("Unsupported content type.")
                    return
                }
            } catch {
                state = .error("File load failed: \(error.localizedDescription)")
                return
            }
        } else {
            state = .error("Nothing to share.")
            return
        }

        // Content loaded — now fetch slots
        await fetchSlots()
    }

    // MARK: - API: Slots

    func fetchSlots() async {
        state = .loadingSlots
        guard let url = URL(string: "\(serverURL)/api/chat/slots") else {
            state = .idle
            return
        }
        do {
            let (data, _) = try await session.data(from: url)
            // Response is [{key, title}] or [{key, label}]
            if let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
                availableSlots = arr.compactMap { dict -> SlotInfo? in
                    guard let key = dict["key"] as? String else { return nil }
                    let title = (dict["title"] as? String)
                        ?? (dict["label"] as? String)
                        ?? key
                    return SlotInfo(id: key, title: title)
                }
            }
        } catch {
            // Non-fatal — just leave slots empty
        }
        state = .idle
    }

    // MARK: - Send

    func send() async {
        guard state == .idle else { return }
        state = .sending

        do {
            let slotKey: String
            if let existing = selectedSlotID {
                slotKey = existing
            } else {
                slotKey = try await createSlot()
            }

            try await postMessage(slotKey: slotKey)
            state = .success

            // Complete the extension request after a brief delay
            try? await Task.sleep(nanoseconds: 800_000_000)
            extensionContext.completeRequest(returningItems: nil)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    // MARK: - API: Create Slot

    private func createSlot() async throws -> String {
        guard let url = URL(string: "\(serverURL)/api/chat/slots") else {
            throw URLError(.badURL)
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: [String: String](), options: [])

        let (data, _) = try await session.data(for: req)
        if let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let key = dict["key"] as? String {
            return key
        }
        throw NSError(domain: "PiDashShare", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "Failed to create slot"])
    }

    // MARK: - API: Post Message

    private func postMessage(slotKey: String) async throws {
        guard let url = URL(string: "\(serverURL)/api/chat?ws=1") else {
            throw URLError(.badURL)
        }

        var body: [String: Any] = ["slot": slotKey]

        switch sharedContent {
        case .text(let text):
            let msg = additionalMessage.isEmpty ? text : "\(additionalMessage)\n\n\(text)"
            body["message"] = msg

        case .url(let shareURL):
            let msg = additionalMessage.isEmpty
                ? shareURL.absoluteString
                : "\(additionalMessage)\n\n\(shareURL.absoluteString)"
            body["message"] = msg

        case .image(let image):
            guard let jpeg = image.jpegData(compressionQuality: 0.8) else {
                throw NSError(domain: "PiDashShare", code: 2,
                              userInfo: [NSLocalizedDescriptionKey: "Could not encode image"])
            }
            let b64 = jpeg.base64EncodedString()
            body["images"] = [b64]
            if !additionalMessage.isEmpty {
                body["message"] = additionalMessage
            }

        case .file(let name, let data):
            if let img = UIImage(data: data), let jpeg = img.jpegData(compressionQuality: 0.8) {
                let b64 = jpeg.base64EncodedString()
                body["images"] = [b64]
                if !additionalMessage.isEmpty { body["message"] = additionalMessage }
            } else {
                let note = "Attached file: \(name) (\(data.count) bytes)"
                let msg = additionalMessage.isEmpty ? note : "\(additionalMessage)\n\n\(note)"
                body["message"] = msg
            }

        case nil:
            if additionalMessage.isEmpty {
                throw NSError(domain: "PiDashShare", code: 3,
                              userInfo: [NSLocalizedDescriptionKey: "Nothing to send"])
            }
            body["message"] = additionalMessage
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await session.data(for: req)
        if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
            throw NSError(domain: "PiDashShare", code: http.statusCode,
                          userInfo: [NSLocalizedDescriptionKey: "Server error \(http.statusCode)"])
        }
    }
}
