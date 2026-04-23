import Foundation

// MARK: - IntentError

enum IntentError: Error, LocalizedError {
    case invalidURL
    case httpError(Int)
    case decodingError
    case networkError(Error)
    case timeout
    case noResponse

    var errorDescription: String? {
        switch self {
        case .invalidURL:          return "Invalid server URL"
        case .httpError(let code): return "HTTP error \(code)"
        case .decodingError:       return "Failed to decode response"
        case .networkError(let e): return e.localizedDescription
        case .timeout:             return "Pi did not respond in time (30 s)"
        case .noResponse:          return "No response from Pi"
        }
    }
}

// MARK: - IntentNetworking

/// Standalone URLSession-based networking layer for AppIntent perform() methods.
/// Does NOT depend on the app's APIClient actor or WebSocketManager — avoids
/// actor-isolation issues and the live WebSocket connection.
struct IntentNetworking {

    // MARK: Session / decoder (shared singletons)

    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        return URLSession(
            configuration: config,
            delegate: IntentInsecureDelegate(),
            delegateQueue: nil
        )
    }()

    private static let decoder = JSONDecoder()

    // MARK: Base URL

    private static var baseURL: String {
        (UserDefaults(suiteName: ServerConfig.appGroupSuite) ?? .standard)
            .string(forKey: ServerConfig.userDefaultsKey) ?? ServerConfig.defaultBaseURL
    }

    private static func apiURL(path: String) throws -> URL {
        guard let url = URL(string: "\(baseURL)/api\(path)") else {
            throw IntentError.invalidURL
        }
        return url
    }

    // MARK: - Public API

    /// `GET /api/chat/slots` → active chat slots
    static func fetchSlots() async throws -> [ChatSlot] {
        let url = try apiURL(path: "/chat/slots")
        let data = try await get(url: url)
        let dtos = try decoder.decode([SlotDTO].self, from: data)
        return dtos.map { $0.toChatSlot() }
    }

    /// `POST /api/chat/slots` → new slot
    static func createSlot() async throws -> ChatSlot {
        let url = try apiURL(path: "/chat/slots")
        let body = CreateSlotRequest(title: nil, cwd: nil)
        let data = try await post(url: url, body: body)
        let dto = try decoder.decode(SlotDTO.self, from: data)
        return dto.toChatSlot()
    }

    /// `POST /api/chat?ws=1` — fire-and-forget; response streams over WebSocket
    static func sendMessage(slotKey: String, message: String) async throws {
        let url = try apiURL(path: "/chat?ws=1")
        let body = SendMessageRequest(slot: slotKey, message: message, images: nil)
        _ = try await post(url: url, body: body)
    }

    /// `GET /api/chat/slots/:key` → messages in the slot
    static func fetchSlotDetail(key: String) async throws -> [ChatMessage] {
        let url = try apiURL(path: "/chat/slots/\(key)")
        let data = try await get(url: url)
        let response = try decoder.decode(SlotDetailResponse.self, from: data)
        return response.messages.map { $0.toChatMessage(slotKey: key) }
    }

    /// `GET /api/status` → connection status string
    static func fetchStatus() async throws -> String {
        let url = try apiURL(path: "/status")
        let data = try await get(url: url)
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let version = json["version"] as? String {
            return "Connected — v\(version)"
        }
        return "Connected"
    }

    // MARK: - Ask Pi (create + send + poll)

    /// Creates a new slot, sends `question`, then polls up to 30 s for a stable
    /// assistant reply. Returns the response text.
    static func askPi(question: String) async throws -> String {
        let slot = try await createSlot()
        try await sendMessage(slotKey: slot.key, message: question)

        // Poll 15 × 2 s = 30 s max; return when content is stable across 2 polls.
        var lastContent = ""
        var stableCount = 0

        for _ in 0..<15 {
            try await Task.sleep(nanoseconds: 2_000_000_000)
            let messages = try await fetchSlotDetail(key: slot.key)
            let assistantMessages = messages.filter { $0.role == .assistant }
            guard let last = assistantMessages.last, !last.content.isEmpty else {
                continue
            }
            if last.content == lastContent {
                stableCount += 1
                if stableCount >= 2 { return last.content }
            } else {
                lastContent = last.content
                stableCount = 0
            }
        }

        if !lastContent.isEmpty { return lastContent }
        throw IntentError.timeout
    }

    // MARK: - HTTP helpers

    private static func get(url: URL) async throws -> Data {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        return try await perform(request)
    }

    private static func post<B: Encodable>(url: URL, body: B) async throws -> Data {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await perform(request)
    }

    private static func perform(_ request: URLRequest) async throws -> Data {
        do {
            let (data, response) = try await session.data(for: request)
            if let http = response as? HTTPURLResponse,
               !(200..<300).contains(http.statusCode) {
                throw IntentError.httpError(http.statusCode)
            }
            return data
        } catch let error as IntentError {
            throw error
        } catch {
            throw IntentError.networkError(error)
        }
    }
}

// MARK: - IntentInsecureDelegate

/// Accepts all server trust challenges so intents work against local / Tailscale
/// servers without TLS certificates.
private final class IntentInsecureDelegate: NSObject, URLSessionDelegate {
    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let trust = challenge.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }
}
