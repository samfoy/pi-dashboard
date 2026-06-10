import Foundation

// MARK: - ServerConfig

/// Manages the server base URL and derived endpoint URLs.
struct ServerConfig {
    static let defaultBaseURL = "http://samuels-macbook-air-1.taile86245.ts.net:7777"
    static let userDefaultsKey = "serverBaseURL"
    static let cwdDefaultsKey = "defaultCwd"
    static let tokenDefaultsKey = "serverAuthToken"
    static let defaultModelKey = "defaultModel"
    static let defaultThinkingLevelKey = "defaultThinkingLevel"
    static let appGroupSuite = "group.com.sam.pidash"

    /// Shared App Group UserDefaults; falls back to .standard if the suite is unavailable
    /// (e.g. in unit tests / simulator without entitlements provisioned).
    static var sharedDefaults: UserDefaults {
        UserDefaults(suiteName: appGroupSuite) ?? .standard
    }

    private(set) var baseURL: String
    private(set) var defaultCwd: String
    private(set) var defaultModel: String
    private(set) var defaultThinkingLevel: String

    init(baseURL: String? = nil) {
        let shared = Self.sharedDefaults

        for key in [Self.userDefaultsKey, Self.cwdDefaultsKey] {
            if shared.object(forKey: key) == nil,
               let existing = UserDefaults.standard.object(forKey: key) {
                shared.set(existing, forKey: key)
            }
        }
        for key in [Self.userDefaultsKey, Self.cwdDefaultsKey] {
            if UserDefaults.standard.object(forKey: key) == nil,
               let existing = shared.object(forKey: key) {
                UserDefaults.standard.set(existing, forKey: key)
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
        self.defaultModel = shared.string(forKey: Self.defaultModelKey) ?? ""
        self.defaultThinkingLevel = shared.string(forKey: Self.defaultThinkingLevelKey) ?? ""
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

    mutating func update(defaultModel: String) {
        self.defaultModel = defaultModel
        if defaultModel.isEmpty {
            Self.sharedDefaults.removeObject(forKey: Self.defaultModelKey)
        } else {
            Self.sharedDefaults.set(defaultModel, forKey: Self.defaultModelKey)
        }
    }

    mutating func update(defaultThinkingLevel: String) {
        self.defaultThinkingLevel = defaultThinkingLevel
        if defaultThinkingLevel.isEmpty {
            Self.sharedDefaults.removeObject(forKey: Self.defaultThinkingLevelKey)
        } else {
            Self.sharedDefaults.set(defaultThinkingLevel, forKey: Self.defaultThinkingLevelKey)
        }
    }

    var apiBase: String { "\(baseURL)/api" }

    var wsURL: URL? {
        var urlString = baseURL
        urlString = urlString.replacingOccurrences(of: "http://", with: "ws://")
        urlString = urlString.replacingOccurrences(of: "https://", with: "wss://")
        let wsPath = "\(urlString)/api/ws"
        return URL(string: wsPath)
    }

    func url(path: String) -> URL? {
        URL(string: "\(apiBase)\(path)")
    }
}
