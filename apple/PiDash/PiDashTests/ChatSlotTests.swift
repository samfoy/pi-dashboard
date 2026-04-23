import XCTest
@testable import PiDash

final class ChatSlotTests: XCTestCase {

    // MARK: - Initialization

    func testDefaultInit() {
        let slot = ChatSlot(key: "chat-1-123", title: "Test")
        XCTAssertEqual(slot.key, "chat-1-123")
        XCTAssertEqual(slot.title, "Test")
        XCTAssertEqual(slot.messageCount, 0)
        XCTAssertFalse(slot.isStreaming)
        XCTAssertNil(slot.lastMessage)
        XCTAssertNil(slot.model)
        XCTAssertNil(slot.contextPercent)
        XCTAssertFalse(slot.inputNeeded)
        XCTAssertNil(slot.cwd)
    }

    func testFullInit() {
        let date = Date()
        let slot = ChatSlot(
            key: "chat-1-999",
            title: "Full Slot",
            createdAt: date,
            updatedAt: date,
            messageCount: 10,
            lastMessage: "Last msg",
            isStreaming: true,
            model: "claude-sonnet",
            contextPercent: 42.5,
            inputNeeded: true,
            cwd: "/Users/test"
        )
        XCTAssertEqual(slot.messageCount, 10)
        XCTAssertEqual(slot.lastMessage, "Last msg")
        XCTAssertTrue(slot.isStreaming)
        XCTAssertEqual(slot.model, "claude-sonnet")
        XCTAssertEqual(slot.contextPercent, 42.5)
        XCTAssertTrue(slot.inputNeeded)
        XCTAssertEqual(slot.cwd, "/Users/test")
    }

    // MARK: - Identifiable

    func testIdentifiable() {
        let slot = ChatSlot(key: "chat-1-abc", title: "Test")
        XCTAssertEqual(slot.id, "chat-1-abc")
    }

    // MARK: - Codable Round-Trip

    func testCodableRoundTrip() throws {
        let slot = ChatSlot(
            key: "chat-1-123",
            title: "Codable Test",
            createdAt: Date(timeIntervalSince1970: 1713400000),
            updatedAt: Date(timeIntervalSince1970: 1713400100),
            messageCount: 5,
            lastMessage: "hello",
            isStreaming: false,
            model: "gpt-4"
        )

        let data = try JSONEncoder().encode(slot)
        let decoded = try JSONDecoder().decode(ChatSlot.self, from: data)

        XCTAssertEqual(decoded.key, slot.key)
        XCTAssertEqual(decoded.title, slot.title)
        XCTAssertEqual(decoded.messageCount, slot.messageCount)
        XCTAssertEqual(decoded.model, slot.model)
    }

    // MARK: - Equatable

    func testEquatable() {
        let date = Date()
        let slot1 = ChatSlot(key: "chat-1-123", title: "A", createdAt: date, updatedAt: date)
        let slot2 = ChatSlot(key: "chat-1-123", title: "A", createdAt: date, updatedAt: date)
        XCTAssertEqual(slot1, slot2)
    }

    // MARK: - Mutability

    func testMutability() {
        var slot = ChatSlot(key: "chat-1-123", title: "Original")
        slot.title = "Updated"
        slot.isStreaming = true
        slot.messageCount = 5
        XCTAssertEqual(slot.title, "Updated")
        XCTAssertTrue(slot.isStreaming)
        XCTAssertEqual(slot.messageCount, 5)
    }

    // MARK: - TemporalGroup

    func testTemporalGroupToday() {
        let group = TemporalGroup.group(for: Date())
        XCTAssertEqual(group, .today)
        XCTAssertEqual(group.label, "Today")
    }

    func testTemporalGroupYesterday() {
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        let group = TemporalGroup.group(for: yesterday)
        XCTAssertEqual(group, .yesterday)
        XCTAssertEqual(group.label, "Yesterday")
    }

    func testTemporalGroupLastSevenDays() {
        let fiveDaysAgo = Calendar.current.date(byAdding: .day, value: -5, to: Date())!
        let group = TemporalGroup.group(for: fiveDaysAgo)
        XCTAssertEqual(group, .lastSevenDays)
        XCTAssertEqual(group.label, "Last 7 Days")
    }

    func testTemporalGroupLastThirtyDays() {
        let twentyDaysAgo = Calendar.current.date(byAdding: .day, value: -20, to: Date())!
        let group = TemporalGroup.group(for: twentyDaysAgo)
        XCTAssertEqual(group, .lastThirtyDays)
        XCTAssertEqual(group.label, "Last 30 Days")
    }

    func testTemporalGroupOlderMonth() {
        let sixtyDaysAgo = Calendar.current.date(byAdding: .day, value: -60, to: Date())!
        let group = TemporalGroup.group(for: sixtyDaysAgo)
        if case .month(let label) = group {
            // Should be something like "February 2026"
            XCTAssertFalse(label.isEmpty)
        } else {
            XCTFail("Expected .month case for date 60 days ago")
        }
    }

    func testTemporalGroupLabels() {
        XCTAssertEqual(TemporalGroup.today.label, "Today")
        XCTAssertEqual(TemporalGroup.yesterday.label, "Yesterday")
        XCTAssertEqual(TemporalGroup.lastSevenDays.label, "Last 7 Days")
        XCTAssertEqual(TemporalGroup.lastThirtyDays.label, "Last 30 Days")
        XCTAssertEqual(TemporalGroup.month("March 2026").label, "March 2026")
    }

    func testTemporalGroupHashable() {
        let set: Set<TemporalGroup> = [.today, .yesterday, .today]
        XCTAssertEqual(set.count, 2)
    }
}
