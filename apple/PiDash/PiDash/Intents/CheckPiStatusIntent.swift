import AppIntents

// MARK: - CheckPiStatusIntent

/// Attempts to reach the Pi server and returns its connectivity status.
/// Never throws — network failures are returned as a descriptive string.
///
/// Siri phrase examples (configured in PiDashShortcuts):
///   • "Check Pi status"
///   • "Pi status"
struct CheckPiStatusIntent: AppIntent {
    static var title: LocalizedStringResource = "Check Pi Status"
    static var description = IntentDescription(
        "Checks whether the Pi server is reachable and returns its version."
    )

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        do {
            let status = try await IntentNetworking.fetchStatus()
            return .result(value: status)
        } catch {
            return .result(value: "Unreachable: \(error.localizedDescription)")
        }
    }
}
