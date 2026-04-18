import Foundation

// MARK: - APIError

enum APIError: Error, LocalizedError {
    case invalidURL
    case httpError(Int, String?)
    case decodingError(Error)
    case networkError(Error)
    case unknown

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid server URL"
        case .httpError(let code, let msg): return "HTTP \(code): \(msg ?? "Unknown error")"
        case .decodingError(let e): return "Decode error: \(e.localizedDescription)"
        case .networkError(let e): return e.localizedDescription
        case .unknown: return "Unknown error"
        }
    }
}

// MARK: - APIClient

/// REST API client for pi-dashboard endpoints.
actor APIClient {
    var config: ServerConfig

    private let session: URLSession
    private let decoder: JSONDecoder

    init(config: ServerConfig = ServerConfig()) {
        self.config = config
        let sessionConfig = URLSessionConfiguration.default
        sessionConfig.timeoutIntervalForRequest = 30
        self.session = URLSession(configuration: sessionConfig)

        let dec = JSONDecoder()
        dec.keyDecodingStrategy = .convertFromSnakeCase
        self.decoder = dec
    }

    func updateConfig(_ newConfig: ServerConfig) {
        self.config = newConfig
    }

    // MARK: - Slots

    /// `GET /api/chat/slots` → `[SlotDTO]` (direct array)
    func fetchSlots() async throws -> [ChatSlot] {
        let url = try requireURL(path: "/chat/slots")
        let data = try await get(url: url)
        do {
            let dtos = try decoder.decode([SlotDTO].self, from: data)
            return dtos.map { $0.toChatSlot() }
        } catch {
            throw APIError.decodingError(error)
        }
    }

    /// `GET /api/chat/slots/:key` → flat `SlotDetailResponse`
    func fetchSlotDetail(key: String) async throws -> [ChatMessage] {
        let url = try requireURL(path: "/chat/slots/\(key)")
        let data = try await get(url: url)
        do {
            let response = try decoder.decode(SlotDetailResponse.self, from: data)
            return response.messages.map { $0.toChatMessage(slotKey: key) }
        } catch {
            throw APIError.decodingError(error)
        }
    }

    func createSlot(title: String? = nil) async throws -> ChatSlot {
        let url = try requireURL(path: "/chat/slots")
        let body = CreateSlotRequest(title: title)
        let data = try await post(url: url, body: body)
        do {
            let dto = try decoder.decode(SlotDTO.self, from: data)
            return dto.toChatSlot()
        } catch {
            throw APIError.decodingError(error)
        }
    }

    func deleteSlot(key: String) async throws {
        let url = try requireURL(path: "/chat/slots/\(key)")
        try await delete(url: url)
    }

    /// `POST /api/chat` with `{slot, message}` body
    func sendMessage(slot: String, message: String) async throws {
        let url = try requireURL(path: "/chat")
        let body = SendMessageRequest(slot: slot, message: message)
        _ = try await post(url: url, body: body)
    }

    /// `POST /api/chat/slots/:key/stop`
    func stopGeneration(slot: String) async throws {
        let url = try requireURL(path: "/chat/slots/\(slot)/stop")
        _ = try await post(url: url, body: EmptyBody())
    }

    /// `GET /api/status` — for settings connection test
    func fetchStatus() async throws -> String {
        let url = try requireURL(path: "/status")
        let data = try await get(url: url)
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let version = json["version"] as? String {
            return "Connected — v\(version)"
        }
        return "Connected"
    }

    // MARK: - Private HTTP helpers

    private func get(url: URL) async throws -> Data {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        return try await perform(request)
    }

    private func post<B: Encodable>(url: URL, body: B) async throws -> Data {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await perform(request)
    }

    private func delete(url: URL) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        _ = try await perform(request)
    }

    private func perform(_ request: URLRequest) async throws -> Data {
        do {
            let (data, response) = try await session.data(for: request)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                let body = String(data: data, encoding: .utf8)
                throw APIError.httpError(http.statusCode, body)
            }
            return data
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.networkError(error)
        }
    }

    private func requireURL(path: String) throws -> URL {
        guard let url = config.url(path: path) else {
            throw APIError.invalidURL
        }
        return url
    }
}

private struct EmptyBody: Encodable {}
