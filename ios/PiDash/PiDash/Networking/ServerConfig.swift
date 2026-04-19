import Foundation

// MARK: - ServerConfig

/// Manages the server base URL and derived endpoint URLs.
struct ServerConfig {
    static let defaultBaseURL = "http://samuels-macbook-air-1.taile86245.ts.net:7777"
    static let userDefaultsKey = "serverBaseURL"
    static let cwdDefaultsKey = "defaultCwd"
    static let appGroupSuite = "group.com.sam.pidash"

    /// Shared App Group UserDefaults; falls back to .standard if the suite is unavailable
    /// (e.g. in unit tests / simulator without entitlements provisioned).
    static var sharedDefaults: UserDefaults {
        UserDefaults(suiteName: appGroupSuite) ?? .standard
    }

    private(set) var baseURL: String
    private(set) var defaultCwd: String

    init(baseURL: String? = nil) {
        let shared = Self.sharedDefaults

        // One-time migration: copy values from standard UserDefaults into the shared suite.
        for key in [Self.userDefaultsKey, Self.cwdDefaultsKey] {
            if shared.object(forKey: key) == nil,
               let existing = UserDefaults.standard.object(forKey: key) {
                shared.set(existing, forKey: key)
                UserDefaults.standard.removeObject(forKey: key)
            }
        }

        let stored = shared.string(forKey: Self.userDefaultsKey)
        let resolved = baseURL ?? stored ?? Self.defaultBaseURL
        // Migrate old IP-based URLs to MagicDNS hostname
        if resolved.contains("100.103.130.31") {
            self.baseURL = Self.defaultBaseURL
            shared.removeObject(forKey: Self.userDefaultsKey)
        } else {
            self.baseURL = resolved
        }
        self.defaultCwd = shared.string(forKey: Self.cwdDefaultsKey) ?? ""
    }

    mutating func update(baseURL: String) {
        self.baseURL = baseURL
        Self.sharedDefaults.set(baseURL, forKey: Self.userDefaultsKey)
    }

    mutating func update(cwd: String) {
        self.defaultCwd = cwd
        if cwd.isEmpty {
            Self.sharedDefaults.removeObject(forKey: Self.cwdDefaultsKey)
        } else {
            Self.sharedDefaults.set(cwd, forKey: Self.cwdDefaultsKey)
        }
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
