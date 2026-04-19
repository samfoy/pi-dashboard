import XCTest
@testable import PiDash

final class ServerConfigTests: XCTestCase {

    override func setUp() {
        super.setUp()
        // Clean up any persisted values from previous test runs
        UserDefaults.standard.removeObject(forKey: ServerConfig.userDefaultsKey)
        UserDefaults.standard.removeObject(forKey: ServerConfig.cwdDefaultsKey)
        ServerConfig.sharedDefaults.removeObject(forKey: ServerConfig.userDefaultsKey)
        ServerConfig.sharedDefaults.removeObject(forKey: ServerConfig.cwdDefaultsKey)
    }

    override func tearDown() {
        UserDefaults.standard.removeObject(forKey: ServerConfig.userDefaultsKey)
        UserDefaults.standard.removeObject(forKey: ServerConfig.cwdDefaultsKey)
        ServerConfig.sharedDefaults.removeObject(forKey: ServerConfig.userDefaultsKey)
        ServerConfig.sharedDefaults.removeObject(forKey: ServerConfig.cwdDefaultsKey)
        super.tearDown()
    }

    // MARK: - Defaults

    func testDefaultBaseURL() {
        let config = ServerConfig()
        XCTAssertEqual(config.baseURL, ServerConfig.defaultBaseURL)
    }

    func testDefaultCwdIsEmpty() {
        let config = ServerConfig()
        XCTAssertEqual(config.defaultCwd, "")
    }

    // MARK: - Custom URL

    func testCustomBaseURL() {
        let config = ServerConfig(baseURL: "http://localhost:8080")
        XCTAssertEqual(config.baseURL, "http://localhost:8080")
    }

    // MARK: - URL Construction

    func testApiBase() {
        let config = ServerConfig(baseURL: "http://localhost:8080")
        XCTAssertEqual(config.apiBase, "http://localhost:8080/api")
    }

    func testURLPath() {
        let config = ServerConfig(baseURL: "http://localhost:8080")
        let url = config.url(path: "/chat/slots")
        XCTAssertEqual(url?.absoluteString, "http://localhost:8080/api/chat/slots")
    }

    func testURLPathWithLeadingSlash() {
        let config = ServerConfig(baseURL: "http://example.com:7777")
        let url = config.url(path: "/ws")
        XCTAssertEqual(url?.absoluteString, "http://example.com:7777/api/ws")
    }

    // MARK: - WebSocket URL

    func testWebSocketURLFromHTTP() {
        let config = ServerConfig(baseURL: "http://localhost:7777")
        let wsURL = config.wsURL
        XCTAssertEqual(wsURL?.scheme, "ws")
        XCTAssertEqual(wsURL?.absoluteString, "ws://localhost:7777/api/ws")
    }

    func testWebSocketURLFromHTTPS() {
        let config = ServerConfig(baseURL: "https://secure.example.com:7777")
        let wsURL = config.wsURL
        XCTAssertEqual(wsURL?.scheme, "wss")
        XCTAssertEqual(wsURL?.absoluteString, "wss://secure.example.com:7777/api/ws")
    }

    // MARK: - Update

    func testUpdateBaseURL() {
        var config = ServerConfig(baseURL: "http://localhost:7777")
        config.update(baseURL: "http://newhost:8888")
        XCTAssertEqual(config.baseURL, "http://newhost:8888")
        // Should persist
        XCTAssertEqual(ServerConfig.sharedDefaults.string(forKey: ServerConfig.userDefaultsKey), "http://newhost:8888")
    }

    func testUpdateCwd() {
        var config = ServerConfig(baseURL: "http://localhost:7777")
        config.update(cwd: "/Users/test/project")
        XCTAssertEqual(config.defaultCwd, "/Users/test/project")
        XCTAssertEqual(ServerConfig.sharedDefaults.string(forKey: ServerConfig.cwdDefaultsKey), "/Users/test/project")
    }

    func testUpdateCwdEmpty() {
        var config = ServerConfig(baseURL: "http://localhost:7777")
        config.update(cwd: "/Users/test")
        config.update(cwd: "")
        XCTAssertEqual(config.defaultCwd, "")
        // Empty cwd should remove the key
        XCTAssertNil(ServerConfig.sharedDefaults.string(forKey: ServerConfig.cwdDefaultsKey))
    }

    // MARK: - IP Migration

    func testOldIPMigration() {
        // The old IP should be migrated to the default MagicDNS URL
        let config = ServerConfig(baseURL: "http://100.103.130.31:7777")
        XCTAssertEqual(config.baseURL, ServerConfig.defaultBaseURL)
    }

    // MARK: - Constants

    func testAppGroupSuite() {
        XCTAssertEqual(ServerConfig.appGroupSuite, "group.com.sam.pidash")
    }

    func testUserDefaultsKey() {
        XCTAssertEqual(ServerConfig.userDefaultsKey, "serverBaseURL")
    }
}
