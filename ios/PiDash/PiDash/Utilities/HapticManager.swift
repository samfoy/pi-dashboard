import UIKit

// MARK: - HapticManager

enum HapticManager {
    static func messageSent() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    static func messageReceived() {
        UIImpactFeedbackGenerator(style: .soft).impactOccurred()
    }

    static func streamingComplete() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    static func error() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }

    static func selectionChanged() {
        UISelectionFeedbackGenerator().selectionChanged()
    }

    static func slotDeleted() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }
}
