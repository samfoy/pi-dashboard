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
        let delegate = InsecureSessionDelegate()
        self.session = URLSession(configuration: sessionConfig, delegate: delegate, delegateQueue: nil)

        let dec = JSONDecoder()
        // Don't use convertFromSnakeCase — API mixes snake_case and camelCase.
        // Individual DTOs use explicit CodingKeys instead.
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
    struct SlotDetailResult {
        let messages: [ChatMessage]
        let running: Bool
        let tokenStats: TokenStatsDTO?
        let thinkingLevel: String?
    }

    func fetchSlotDetail(key: String) async throws -> SlotDetailResult {
        let url = try requireURL(path: "/chat/slots/\(key)")
        let data = try await get(url: url)
        do {
            let response = try decoder.decode(SlotDetailResponse.self, from: data)
            let msgs = response.messages.map { $0.toChatMessage(slotKey: key) }
            return SlotDetailResult(messages: msgs, running: response.running ?? false, tokenStats: response.tokenStats, thinkingLevel: response.thinkingLevel)
        } catch {
            let preview = String(data: data.prefix(500), encoding: .utf8) ?? "(binary)"
            print("[APIClient] Decode error for slot detail: \(error)")
            print("[APIClient] Response preview: \(preview)")
            throw APIError.decodingError(error)
        }
    }

    func createSlot(title: String? = nil, cwd: String? = nil) async throws -> ChatSlot {
        let url = try requireURL(path: "/chat/slots")
        let body = CreateSlotRequest(title: title, cwd: cwd)
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

    /// `PATCH /api/chat/slots/:key/title`
    func renameSlot(key: String, title: String) async throws {
        let url = try requireURL(path: "/chat/slots/\(key)/title")
        let body = RenameSlotRequest(title: title)
        _ = try await patch(url: url, body: body)
    }

    /// `POST /api/chat?ws=1` with `{slot, message, images?}` body
    func sendMessage(slot: String, message: String, images: [ImagePayload]? = nil) async throws {
        let url = try requireURL(path: "/chat?ws=1")
        let body = SendMessageRequest(slot: slot, message: message, images: images?.isEmpty == true ? nil : images)
        _ = try await post(url: url, body: body)
    }

    /// `POST /api/chat/slots/:key/stop`
    func stopGeneration(slot: String) async throws {
        let url = try requireURL(path: "/chat/slots/\(slot)/stop")
        _ = try await post(url: url, body: EmptyBody())
    }

    // MARK: - Slash Commands

    /// `GET /api/slash-commands` → `[SlashCommand]` (direct array)
    func fetchSlashCommands() async throws -> [SlashCommand] {
        let url = try requireURL(path: "/slash-commands")
        let data = try await get(url: url)
        do {
            let dtos = try decoder.decode([SlashCommandDTO].self, from: data)
            return dtos.map { $0.toSlashCommand() }
        } catch {
            throw APIError.decodingError(error)
        }
    }

    // MARK: - Models & Thinking

    /// `GET /api/models` → available models
    func fetchModels() async throws -> [ModelInfo] {
        let url = try requireURL(path: "/models")
        let data = try await get(url: url)
        let response = try decoder.decode(ModelsResponse.self, from: data)
        return response.models
    }

    /// `POST /api/chat/slots/:key/model`
    func setModel(slot: String, provider: String, modelId: String) async throws {
        let url = try requireURL(path: "/chat/slots/\(slot)/model")
        let body = SetModelRequest(provider: provider, modelId: modelId)
        _ = try await post(url: url, body: body)
    }

    /// `POST /api/chat/slots/:key/thinking`
    func setThinking(slot: String, level: String) async throws {
        let url = try requireURL(path: "/chat/slots/\(slot)/thinking")
        let body = SetThinkingRequest(level: level)
        _ = try await post(url: url, body: body)
    }

    /// `GET /api/chat/slots/:key/git` — best-effort git summary for the slot's cwd
    func fetchGitSummary(slot: String) async throws -> GitSummaryDTO {
        let url = try requireURL(path: "/chat/slots/\(slot)/git")
        let data = try await get(url: url)
        return try decoder.decode(GitSummaryDTO.self, from: data)
    }

    /// `PATCH /api/chat/slots/:key/tags` — set tags for a slot
    func setTags(slot: String, tags: [String]) async throws -> [String] {
        let url = try requireURL(path: "/chat/slots/\(slot)/tags")
        let body = SetTagsRequest(tags: tags)
        let data = try await patch(url: url, body: body)
        struct TagsResponse: Decodable { let tags: [String] }
        let response = try decoder.decode(TagsResponse.self, from: data)
        return response.tags
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

    // MARK: - Notifications

    /// `GET /api/notifications` → unacknowledged notifications
    func fetchNotifications() async throws -> [NotificationDTO] {
        let url = try requireURL(path: "/notifications")
        let data = try await get(url: url)
        do {
            let response = try decoder.decode(NotificationsResponse.self, from: data)
            return response.notifications
        } catch {
            throw APIError.decodingError(error)
        }
    }

    /// `POST /api/notifications/ack` — acknowledge a single notification by ts
    func ackNotification(ts: String) async throws {
        let url = try requireURL(path: "/notifications/ack")
        let body = AckNotificationRequest(ts: ts)
        _ = try await post(url: url, body: body)
    }

    // MARK: - File I/O

    /// `GET /api/file-read?path=` → plain text file content
    func readFile(path: String) async throws -> String {
        guard var components = URLComponents(url: try requireURL(path: "/file-read"), resolvingAgainstBaseURL: false) else {
            throw APIError.invalidURL
        }
        components.queryItems = [URLQueryItem(name: "path", value: path)]
        guard let url = components.url else { throw APIError.invalidURL }
        let data = try await get(url: url)
        return String(data: data, encoding: .utf8) ?? ""
    }

    /// `GET /api/file-versions?path=` → version list
    func getFileVersions(path: String) async throws -> [FileVersion] {
        guard var components = URLComponents(url: try requireURL(path: "/file-versions"), resolvingAgainstBaseURL: false) else {
            throw APIError.invalidURL
        }
        components.queryItems = [URLQueryItem(name: "path", value: path)]
        guard let url = components.url else { throw APIError.invalidURL }
        let data = try await get(url: url)
        do {
            let response = try decoder.decode(FileVersionsResponse.self, from: data)
            return response.versions
        } catch {
            throw APIError.decodingError(error)
        }
    }

    /// `GET /api/file-version?path=&version=` → plain text version content
    func getFileVersion(path: String, version: Int) async throws -> String {
        guard var components = URLComponents(url: try requireURL(path: "/file-version"), resolvingAgainstBaseURL: false) else {
            throw APIError.invalidURL
        }
        components.queryItems = [
            URLQueryItem(name: "path", value: path),
            URLQueryItem(name: "version", value: "\(version)"),
        ]
        guard let url = components.url else { throw APIError.invalidURL }
        let data = try await get(url: url)
        return String(data: data, encoding: .utf8) ?? ""
    }

    // MARK: - Sessions

    /// `GET /api/sessions` → recent pi agent sessions
    func fetchSessions(limit: Int = 30) async throws -> [SessionDTO] {
        guard var components = URLComponents(url: try requireURL(path: "/sessions"), resolvingAgainstBaseURL: false) else {
            throw APIError.invalidURL
        }
        components.queryItems = [URLQueryItem(name: "limit", value: "\(limit)")]
        guard let url = components.url else { throw APIError.invalidURL }
        let data = try await get(url: url)
        do {
            let response = try decoder.decode(SessionsResponse.self, from: data)
            return response.sessions
        } catch {
            throw APIError.decodingError(error)
        }
    }

    /// `POST /api/chat/slots/:key/resume` → creates a new slot resuming the given session key
    func resumeSession(key: String, file: String? = nil) async throws -> String {
        let url = try requireURL(path: "/chat/slots/\(key)/resume")
        let body = ResumeSessionRequest(key: key, file: file)
        let data = try await post(url: url, body: body)
        do {
            let response = try decoder.decode(ResumeResponse.self, from: data)
            return response.key
        } catch {
            throw APIError.decodingError(error)
        }
    }

    /// `GET /api/sessions/search?q=&limit=` → search past sessions via FTS5
    func searchSessions(query: String, limit: Int = 20) async throws -> [SessionSearchResult] {
        guard var components = URLComponents(url: try requireURL(path: "/sessions/search"), resolvingAgainstBaseURL: false) else {
            throw APIError.invalidURL
        }
        var items = [URLQueryItem(name: "limit", value: "\(limit)")]
        if !query.isEmpty {
            items.append(URLQueryItem(name: "q", value: query))
        }
        components.queryItems = items
        guard let url = components.url else { throw APIError.invalidURL }
        let data = try await get(url: url)
        do {
            let response = try decoder.decode(SessionSearchResponse.self, from: data)
            return response.results
        } catch {
            throw APIError.decodingError(error)
        }
    }

    // MARK: - Browse

    /// `GET /api/browse?path=` → directory listing
    func fetchBrowse(path: String? = nil) async throws -> BrowseResponse {
        guard var components = URLComponents(url: try requireURL(path: "/browse"), resolvingAgainstBaseURL: false) else {
            throw APIError.invalidURL
        }
        if let path {
            components.queryItems = [URLQueryItem(name: "path", value: path)]
        }
        guard let url = components.url else { throw APIError.invalidURL }
        let data = try await get(url: url)
        do {
            return try decoder.decode(BrowseResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    /// `POST /api/chat/slots/:key/cwd` — update the working directory for a slot
    func setCwd(slotKey: String, cwd: String) async throws {
        let url = try requireURL(path: "/chat/slots/\(slotKey)/cwd")
        let body = SetCwdRequest(cwd: cwd)
        _ = try await post(url: url, body: body)
    }

    // MARK: - Generate title

    /// `POST /api/chat/slots/:key/generate-title` → `{ok, title}`
    func generateTitle(slot: String) async throws -> String {
        let url = try requireURL(path: "/chat/slots/\(slot)/generate-title")
        let data = try await post(url: url, body: EmptyBody())
        let response = try decoder.decode(GenerateTitleResponse.self, from: data)
        return response.title
    }

    // MARK: - System Prompt

    /// `GET /api/chat/slots/:key/system-prompt`
    func fetchSystemPrompt(slot: String) async throws -> SystemPromptResponse {
        let url = try requireURL(path: "/chat/slots/\(slot)/system-prompt")
        let data = try await get(url: url)
        return try decoder.decode(SystemPromptResponse.self, from: data)
    }

    // MARK: - Session Tree / Fork

    /// `GET /api/chat/slots/:key/tree` → session JSONL parsed as a tree
    func fetchSessionTree(slot: String) async throws -> SessionTreeResponse {
        let url = try requireURL(path: "/chat/slots/\(slot)/tree")
        let data = try await get(url: url)
        return try decoder.decode(SessionTreeResponse.self, from: data)
    }

    /// `POST /api/chat/slots/:key/fork` → forks at `entryId`, returns new slot
    func forkSlot(slot: String, entryId: String) async throws -> ForkResponse {
        let url = try requireURL(path: "/chat/slots/\(slot)/fork")
        let body = ForkRequest(entryId: entryId)
        let data = try await post(url: url, body: body)
        return try decoder.decode(ForkResponse.self, from: data)
    }

    // MARK: - File upload

    /// `POST /api/upload-files` → uploads arbitrary files, returns server-side paths
    func uploadFiles(_ files: [UploadFileItem]) async throws -> [String] {
        let url = try requireURL(path: "/upload-files")
        let body = UploadFilesRequest(files: files)
        let data = try await post(url: url, body: body)
        let response = try decoder.decode(UploadFilesResponse.self, from: data)
        return response.paths
    }

    // MARK: - Subagents

    /// `GET /api/subagents/status?slot=<key>` → list of subagents for this slot
    func fetchSubagents(slot: String) async throws -> [SubagentInfoDTO] {
        guard var components = URLComponents(url: try requireURL(path: "/subagents/status"), resolvingAgainstBaseURL: false) else {
            throw APIError.invalidURL
        }
        components.queryItems = [URLQueryItem(name: "slot", value: slot)]
        guard let url = components.url else { throw APIError.invalidURL }
        let data = try await get(url: url)
        return (try? decoder.decode([SubagentInfoDTO].self, from: data)) ?? []
    }

    /// `GET /api/subagents/:id/log` → live log tail (plain text)
    func fetchSubagentLog(id: String) async throws -> String {
        let url = try requireURL(path: "/subagents/\(id)/log")
        let data = try await get(url: url)
        return String(data: data, encoding: .utf8) ?? ""
    }

    // MARK: - Private HTTP helpers

    /// Public raw GET for ad-hoc API calls
    func fetchRaw(path: String) async throws -> Data {
        let url = try requireURL(path: path)
        return try await get(url: url)
    }

    private func attachAuth(_ request: inout URLRequest) {
        if !config.token.isEmpty {
            request.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
        }
    }

    private func get(url: URL) async throws -> Data {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        attachAuth(&request)
        return try await perform(request)
    }

    private func post<B: Encodable>(url: URL, body: B) async throws -> Data {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        attachAuth(&request)
        request.httpBody = try JSONEncoder().encode(body)
        return try await perform(request)
    }

    private func patch<B: Encodable>(url: URL, body: B) async throws -> Data {
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        attachAuth(&request)
        request.httpBody = try JSONEncoder().encode(body)
        return try await perform(request)
    }

    private func delete(url: URL) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        attachAuth(&request)
        _ = try await perform(request)
    }

    private func perform(_ request: URLRequest) async throws -> Data {
        do {
            print("[APIClient] \(request.httpMethod ?? "?") \(request.url?.absoluteString ?? "nil")")
            let (data, response) = try await session.data(for: request)
            if let http = response as? HTTPURLResponse {
                print("[APIClient] Response: \(http.statusCode) (\(data.count) bytes)")
                if !(200..<300).contains(http.statusCode) {
                    let body = String(data: data, encoding: .utf8)
                    throw APIError.httpError(http.statusCode, body)
                }
            }
            return data
        } catch let error as APIError {
            print("[APIClient] APIError: \(error.errorDescription ?? "")")
            throw error
        } catch is CancellationError {
            throw CancellationError()
        } catch let urlError as URLError where urlError.code == .cancelled {
            throw CancellationError()
        } catch {
            print("[APIClient] Error: \(type(of: error)) \(error.localizedDescription)")
            print("[APIClient] Error detail: \(error)")
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

// MARK: - Insecure Session Delegate

/// Allows plain HTTP connections by accepting all server trust challenges.
/// Required for connecting to local/Tailscale servers without TLS.
private final class InsecureSessionDelegate: NSObject, URLSessionDelegate {
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
