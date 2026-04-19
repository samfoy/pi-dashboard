import XCTest
@testable import PiDash

// Note: ShareViewModel lives in PiDashShare extension, which is a separate module.
// We can't directly @testable import it from the PiDash test host.
// Instead, test the supporting types that are accessible, and test the
// shared types (ShareAction, ShareState, SharedContent) if they're in the main target.
// Since they're in the share extension, we test the patterns here using
// the API model types that the share extension depends on.

/// Tests for share-related logic patterns used by the share extension.
/// Since ShareViewModel is in the PiDashShare extension target (not testable from PiDash host),
/// we validate the shared API patterns and slot info parsing.
final class ShareViewModelTests: XCTestCase {

    // MARK: - Slot List Parsing (mirrors ShareViewModel.fetchSlots)

    func testSlotListParsingFromJSON() throws {
        // The share extension parses slot list JSON manually via JSONSerialization
        let json = """
        [
            { "key": "chat-1-100", "title": "Debug session" },
            { "key": "chat-2-200", "title": "Research" },
            { "key": "chat-3-300", "label": "Label fallback" }
        ]
        """.data(using: .utf8)!

        let arr = try JSONSerialization.jsonObject(with: json) as! [[String: Any]]
        let slots = arr.compactMap { dict -> (id: String, title: String)? in
            guard let key = dict["key"] as? String else { return nil }
            let title = (dict["title"] as? String)
                ?? (dict["label"] as? String)
                ?? key
            return (id: key, title: title)
        }

        XCTAssertEqual(slots.count, 3)
        XCTAssertEqual(slots[0].id, "chat-1-100")
        XCTAssertEqual(slots[0].title, "Debug session")
        XCTAssertEqual(slots[2].title, "Label fallback")
    }

    func testSlotListParsingMissingKey() throws {
        let json = """
        [
            { "title": "No key" },
            { "key": "chat-1-100", "title": "Valid" }
        ]
        """.data(using: .utf8)!

        let arr = try JSONSerialization.jsonObject(with: json) as! [[String: Any]]
        let slots = arr.compactMap { dict -> (id: String, title: String)? in
            guard let key = dict["key"] as? String else { return nil }
            let title = (dict["title"] as? String) ?? key
            return (id: key, title: title)
        }

        XCTAssertEqual(slots.count, 1)
    }

    func testSlotListParsingEmptyArray() throws {
        let json = "[]".data(using: .utf8)!
        let arr = try JSONSerialization.jsonObject(with: json) as! [[String: Any]]
        XCTAssertTrue(arr.isEmpty)
    }

    // MARK: - Server URL Construction (mirrors ShareViewModel pattern)

    func testShareAPIURLConstruction() {
        let serverURL = "http://localhost:7777"
        let slotsURL = URL(string: "\(serverURL)/api/chat/slots")
        XCTAssertNotNil(slotsURL)
        XCTAssertEqual(slotsURL?.absoluteString, "http://localhost:7777/api/chat/slots")

        let chatURL = URL(string: "\(serverURL)/api/chat?ws=1")
        XCTAssertNotNil(chatURL)
        XCTAssertEqual(chatURL?.query, "ws=1")
    }

    // MARK: - Message Body Construction (mirrors postMessage pattern)

    func testTextMessageBodyConstruction() {
        let actionPrefix = "Summarize this and save a note to my vault:\n\n"
        let sharedText = "Some interesting article content"
        let additionalMessage = "Focus on the key points"

        let content = actionPrefix + sharedText
        let msg = "\(additionalMessage)\n\n\(content)"

        XCTAssertTrue(msg.contains(actionPrefix))
        XCTAssertTrue(msg.contains(sharedText))
        XCTAssertTrue(msg.contains(additionalMessage))
    }

    func testURLMessageBodyConstruction() {
        let actionPrefix = "Research this link and give me a summary of what's useful:\n\n"
        let shareURL = URL(string: "https://example.com/article")!

        let content = actionPrefix + shareURL.absoluteString
        XCTAssertTrue(content.contains("https://example.com/article"))
        XCTAssertTrue(content.hasPrefix("Research"))
    }

    func testMessageBodyWithoutAdditionalMessage() {
        let content = "Some shared text"
        let additionalMessage = ""
        let msg = additionalMessage.isEmpty ? content : "\(additionalMessage)\n\n\(content)"
        XCTAssertEqual(msg, "Some shared text")
    }

    // MARK: - Create Slot Response Parsing

    func testCreateSlotResponseParsing() throws {
        let json = """
        { "key": "chat-5-1713500000000" }
        """.data(using: .utf8)!

        let dict = try JSONSerialization.jsonObject(with: json) as! [String: Any]
        let key = dict["key"] as? String
        XCTAssertEqual(key, "chat-5-1713500000000")
    }
}
