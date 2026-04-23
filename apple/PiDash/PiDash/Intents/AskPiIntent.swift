import AppIntents

// MARK: - AskPiIntent

/// Creates a new Pi chat, sends the user's question, polls for the response,
/// and returns Pi's reply as a string.
///
/// Siri phrase examples (configured in PiDashShortcuts):
///   • "Ask Pi"
///   • "Ask Pi a question"
struct AskPiIntent: AppIntent {
    static var title: LocalizedStringResource = "Ask Pi"
    static var description = IntentDescription(
        "Ask Pi a question and get its response."
    )

    @Parameter(
        title: "Question",
        description: "The question or prompt to send to Pi.",
        requestValueDialog: "What would you like to ask Pi?"
    )
    var question: String

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let response = try await IntentNetworking.askPi(question: question)
        return .result(value: response)
    }
}
