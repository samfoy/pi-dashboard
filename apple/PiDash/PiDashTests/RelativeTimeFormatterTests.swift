import XCTest
@testable import PiDash

final class RelativeTimeFormatterTests: XCTestCase {

    // MARK: - Just Now

    func testJustNow() {
        let now = Date()
        let result = RelativeTimeFormatter.string(from: now)
        XCTAssertEqual(result, "Just now")
    }

    func testThirtySecondsAgo() {
        let date = Date().addingTimeInterval(-30)
        let result = RelativeTimeFormatter.string(from: date)
        XCTAssertEqual(result, "Just now")
    }

    func testFiftyNineSecondsAgo() {
        let date = Date().addingTimeInterval(-59)
        let result = RelativeTimeFormatter.string(from: date)
        XCTAssertEqual(result, "Just now")
    }

    // MARK: - Minutes Ago

    func testMinutesAgo() {
        let date = Date().addingTimeInterval(-300) // 5 minutes
        let result = RelativeTimeFormatter.string(from: date)
        // RelativeDateTimeFormatter with abbreviated style, e.g. "5 min. ago"
        XCTAssertFalse(result.isEmpty)
        XCTAssertNotEqual(result, "Just now")
    }

    func testThirtyMinutesAgo() {
        let date = Date().addingTimeInterval(-1800) // 30 minutes
        let result = RelativeTimeFormatter.string(from: date)
        XCTAssertFalse(result.isEmpty)
        XCTAssertNotEqual(result, "Just now")
    }

    // MARK: - Today (hours ago → time string)

    func testTwoHoursAgoToday() {
        // If 2 hours ago is still today, should show time format
        let date = Date().addingTimeInterval(-7200)
        let calendar = Calendar.current
        guard calendar.isDateInToday(date) else { return } // Skip if it crosses midnight
        let result = RelativeTimeFormatter.string(from: date)
        // Should be a time like "2:30 PM", not "2 hr. ago"
        XCTAssertFalse(result.isEmpty)
    }

    // MARK: - Yesterday

    func testYesterday() {
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        // Set to noon yesterday to avoid edge cases
        let noon = Calendar.current.date(bySettingHour: 12, minute: 0, second: 0, of: yesterday)!
        let result = RelativeTimeFormatter.string(from: noon)
        XCTAssertEqual(result, "Yesterday")
    }

    // MARK: - Last Week (relative)

    func testFiveDaysAgo() {
        let date = Calendar.current.date(byAdding: .day, value: -5, to: Date())!
        let result = RelativeTimeFormatter.string(from: date)
        // Should be relative format from RelativeDateTimeFormatter
        XCTAssertFalse(result.isEmpty)
        XCTAssertNotEqual(result, "Yesterday")
        XCTAssertNotEqual(result, "Just now")
    }

    // MARK: - Older Dates (formatted date)

    func testTwoWeeksAgo() {
        let date = Calendar.current.date(byAdding: .day, value: -14, to: Date())!
        let result = RelativeTimeFormatter.string(from: date)
        // Should be a formatted date like "Apr 4, 2026"
        XCTAssertFalse(result.isEmpty)
    }

    func testThreeMonthsAgo() {
        let date = Calendar.current.date(byAdding: .month, value: -3, to: Date())!
        let result = RelativeTimeFormatter.string(from: date)
        XCTAssertFalse(result.isEmpty)
    }

    // MARK: - Edge: Very Old Date

    func testVeryOldDate() {
        let date = Date(timeIntervalSince1970: 0) // 1970
        let result = RelativeTimeFormatter.string(from: date)
        XCTAssertFalse(result.isEmpty)
        // Should be a formatted date string
    }

    // MARK: - Edge: Future Date

    func testFutureDate() {
        let future = Date().addingTimeInterval(3600) // 1 hour from now
        let result = RelativeTimeFormatter.string(from: future)
        // diff will be negative, so < 60 is false, < 3600 is false
        // Will fall through to calendar checks
        XCTAssertFalse(result.isEmpty)
    }
}
