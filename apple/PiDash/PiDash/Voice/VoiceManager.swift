import AVFoundation

/// Wraps AVSpeechSynthesizer for hands-free TTS of agent responses.
/// Fires `onSpeakDone` when the utterance finishes so the voice conversation loop
/// can automatically restart speech-to-text.
@MainActor
final class VoiceManager: NSObject {
    private let synthesizer = AVSpeechSynthesizer()

    /// Called when an utterance finishes naturally (not when stopped by `stop()`).
    var onSpeakDone: (() -> Void)?

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    /// Speak `text`, interrupting any current utterance.
    func speak(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { onSpeakDone?(); return }

        synthesizer.stopSpeaking(at: .immediate)

        // Use .playback so audio continues when the screen is locked.
        try? AVAudioSession.sharedInstance().setCategory(.playback, options: .duckOthers)
        try? AVAudioSession.sharedInstance().setActive(true)

        let utterance = AVSpeechUtterance(string: trimmed)
        utterance.rate = 0.52
        utterance.pitchMultiplier = 1.0
        utterance.voice = AVSpeechSynthesisVoice(language: Locale.current.identifier)
        synthesizer.speak(utterance)
    }

    /// Stop speaking immediately. Does NOT fire `onSpeakDone`.
    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
        deactivateAudio()
    }

    private func deactivateAudio() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

// MARK: - AVSpeechSynthesizerDelegate

extension VoiceManager: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { [weak self] in
            self?.deactivateAudio()
            self?.onSpeakDone?()
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { [weak self] in
            self?.deactivateAudio()
        }
    }
}
