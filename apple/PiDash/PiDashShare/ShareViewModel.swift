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
    let updatedAt: String?  // ISO8601 string — sorts lexicographically
}

enum SharedContent {
    case text(String)
    case url(URL)
    case image(UIImage)
    case file(name: String, data: Data)
}

// MARK: - ShareAction

enum ShareAction: Equatable {
    case chat
    case summarizeAndSave
    case extractKeyInfo
    case saveToVault
    case research

    static let allCases: [ShareAction] = [.chat, .summarizeAndSave, .extractKeyInfo, .saveToVault, .research]

    var label: String {
        switch self {
        case .chat:             return "💬 Chat"
        case .summarizeAndSave: return "📝 Summarize & Save"
        case .extractKeyInfo:   return "🔍 Extract Key Info"
        case .saveToVault:      return "📋 Save to Vault"
        case .research:         return "🔗 Research"
        }
    }

    var prefix: String? {
        switch self {
        case .chat:             return nil
        case .summarizeAndSave: return "Summarize this and save a note to my vault:\n\n"
        case .extractKeyInfo:   return "Extract the key information, action items, and anything relevant to me from this:\n\n"
        case .saveToVault:      return "Save this to my Obsidian vault as a note. Pick an appropriate title and location:\n\n"
        case .research:         return "Research this link and give me a summary of what's useful:\n\n"
        }
    }
}

// MARK: - ShareViewModel

@Observable
final class ShareViewModel {

    // MARK: Inputs
    var additionalMessage: String = ""
    var selectedSlotID: String? = nil   // nil = create new chat
    var selectedAction: ShareAction = .chat

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

        // Collect all available content types — apps often share URL + image together
        var foundURL: URL?
        var foundImage: UIImage?
        var foundText: String?
        var foundFile: (name: String, data: Data)?

        for provider in attachments {
            if foundURL == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                if let loaded = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) {
                    if let url = loaded as? URL, !url.isFileURL {
                        foundURL = url
                    }
                }
            }
            if foundImage == nil, provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                if let loaded = try? await provider.loadItem(forTypeIdentifier: UTType.image.identifier) {
                    if let img = loaded as? UIImage {
                        foundImage = img
                    } else if let url = loaded as? URL, let data = try? Data(contentsOf: url),
                              let img = UIImage(data: data) {
                        foundImage = img
                    } else if let data = loaded as? Data, let img = UIImage(data: data) {
                        foundImage = img
                    }
                }
            }
            if foundText == nil, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                if let loaded = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier),
                   let text = loaded as? String {
                    foundText = text
                }
            }
        }

        // If we don't have any of the above, try generic file fallback
        if foundURL == nil && foundImage == nil && foundText == nil {
            if let provider = attachments.first {
                let typeIdentifier = provider.registeredTypeIdentifiers.first ?? UTType.data.identifier
                if let loaded = try? await provider.loadItem(forTypeIdentifier: typeIdentifier),
                   let url = loaded as? URL,
                   let data = try? Data(contentsOf: url) {
                    let name = url.lastPathComponent
                    if let img = UIImage(data: data) {
                        foundImage = img
                    } else {
                        foundFile = (name: name, data: data)
                    }
                }
            }
        }

        // Decide what to use — prefer URL (with image as supplement), then image, then text
        if let url = foundURL {
            // If we also have an image, include it alongside the URL
            if let image = foundImage {
                sharedContent = .image(image)
                // Prepend URL to additional message so both go through
                additionalMessage = url.absoluteString
            } else {
                sharedContent = .url(url)
            }
            selectedAction = .research
        } else if let image = foundImage {
            sharedContent = .image(image)
            selectedAction = .chat
        } else if let text = foundText {
            sharedContent = .text(text)
            selectedAction = .chat
        } else if let file = foundFile {
            sharedContent = .file(name: file.name, data: file.data)
            selectedAction = .chat
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
                    let ts = dict["updated_at"] as? String ?? dict["updatedAt"] as? String
                    return SlotInfo(id: key, title: title, updatedAt: ts)
                }
                .sorted { ($0.updatedAt ?? "") > ($1.updatedAt ?? "") }
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
        let actionPrefix = selectedAction.prefix ?? ""

        switch sharedContent {
        case .text(let text):
            let content = actionPrefix + text
            let msg = additionalMessage.isEmpty ? content : "\(additionalMessage)\n\n\(content)"
            body["message"] = msg

        case .url(let shareURL):
            let content = actionPrefix + shareURL.absoluteString
            let msg = additionalMessage.isEmpty ? content : "\(additionalMessage)\n\n\(content)"
            body["message"] = msg

        case .image(let image):
            guard let jpeg = image.jpegData(compressionQuality: 0.8) else {
                throw NSError(domain: "PiDashShare", code: 2,
                              userInfo: [NSLocalizedDescriptionKey: "Could not encode image"])
            }
            let b64 = jpeg.base64EncodedString()
            body["images"] = [["data": b64, "mimeType": "image/jpeg"]]
            var msgParts: [String] = []
            if !actionPrefix.isEmpty { msgParts.append(actionPrefix.trimmingCharacters(in: .newlines)) }
            if !additionalMessage.isEmpty { msgParts.append(additionalMessage) }
            body["message"] = msgParts.isEmpty ? "Shared image" : msgParts.joined(separator: "\n\n")

        case .file(let name, let data):
            if let img = UIImage(data: data), let jpeg = img.jpegData(compressionQuality: 0.8) {
                let b64 = jpeg.base64EncodedString()
                body["images"] = [["data": b64, "mimeType": "image/jpeg"]]
                var msgParts: [String] = []
                if !actionPrefix.isEmpty { msgParts.append(actionPrefix.trimmingCharacters(in: .newlines)) }
                if !additionalMessage.isEmpty { msgParts.append(additionalMessage) }
                body["message"] = msgParts.isEmpty ? "Shared image" : msgParts.joined(separator: "\n\n")
            } else {
                let note = "Attached file: \(name) (\(data.count) bytes)"
                let content = actionPrefix + note
                let msg = additionalMessage.isEmpty ? content : "\(additionalMessage)\n\n\(content)"
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
