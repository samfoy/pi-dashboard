import AppIntents

// MARK: - SendToPiIntent

/// Creates a new Pi chat slot and sends the provided text as a message.
/// Returns immediately with a confirmation — does not wait for Pi's response.
/// Use this intent in Shortcuts automations where you want to fire-and-forget.
///
/// Siri phrase examples (configured in PiDashShortcuts):
///   • "Send to Pi"
///   • "Send this to Pi"
struct SendToPiIntent: AppIntent {
    static var title: LocalizedStringResource = "Send to Pi"
    static var description = IntentDescription(
        "Send a message to Pi without waiting for a response."
    )

    @Parameter(
        title: "Message",
        description: "The text to send to Pi.",
        requestValueDialog: "What would you like to send to Pi?"
    )
    var message: String

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let slot = try await IntentNetworking.createSlot()
        try await IntentNetworking.sendMessage(slotKey: slot.key, message: message)
        return .result(value: "Message sent to Pi.")
    }
}
