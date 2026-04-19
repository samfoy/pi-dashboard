import AppIntents

// MARK: - PiDashShortcuts

/// Registers suggested App Shortcuts so users can trigger Pi actions directly
/// from Siri or the Shortcuts app without first opening PiDash.
///
/// Phrases containing `\(.applicationName)` will be replaced at runtime by the
/// app's display name ("PiDash"). Siri will prompt for required parameters that
/// are not included in the spoken phrase.
struct PiDashShortcuts: AppShortcutsProvider {

    @AppShortcutsBuilder
    static var appShortcuts: [AppShortcut] {

        AppShortcut(
            intent: AskPiIntent(),
            phrases: [
                "Ask \(.applicationName)",
                "Ask \(.applicationName) a question",
            ],
            shortTitle: "Ask Pi",
            systemImageName: "bubble.left.and.bubble.right"
        )

        AppShortcut(
            intent: SendToPiIntent(),
            phrases: [
                "Send to \(.applicationName)",
                "Send this to \(.applicationName)",
            ],
            shortTitle: "Send to Pi",
            systemImageName: "paperplane"
        )

        AppShortcut(
            intent: GetActiveChatsIntent(),
            phrases: [
                "Get my \(.applicationName) chats",
                "List \(.applicationName) chats",
            ],
            shortTitle: "Get Active Chats",
            systemImageName: "list.bullet"
        )

        AppShortcut(
            intent: CheckPiStatusIntent(),
            phrases: [
                "Check \(.applicationName) status",
                "\(.applicationName) status",
            ],
            shortTitle: "Check Pi Status",
            systemImageName: "wifi"
        )
    }
}
