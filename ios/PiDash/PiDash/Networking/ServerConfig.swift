import Foundation

// MARK: - ServerConfig

/// Manages the server base URL and derived endpoint URLs.
struct ServerConfig {
    static let defaultBaseURL = "http://100.103.130.31:7777"
    static let userDefaultsKey = "serverBaseURL"

    private(set) var baseURL: String

    init(baseURL: String? = nil) {
        let stored = UserDefaults.standard.string(forKey: Self.userDefaultsKey)
        self.baseURL = baseURL ?? stored ?? Self.defaultBaseURL
    }

    mutating func update(baseURL: String) {
        self.baseURL = baseURL
        UserDefaults.standard.set(baseURL, forKey: Self.userDefaultsKey)
    }

    var apiBase: String { "\(baseURL)/api" }

    var wsURL: URL? {
        var urlString = baseURL
        urlString = urlString.replacingOccurrences(of: "http://", with: "ws://")
        urlString = urlString.replacingOccurrences(of: "https://", with: "wss://")
        return URL(string: "\(urlString)/api/ws")
    }

    func url(path: String) -> URL? {
        URL(string: "\(apiBase)\(path)")
    }
}
