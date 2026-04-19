import Foundation
import Speech
import AVFoundation

// MARK: - SpeechService

@Observable final class SpeechService: NSObject {
    static let shared = SpeechService()

    var isRecording: Bool = false

    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var speechRecognizer: SFSpeechRecognizer?

    override private init() {
        super.init()
        let recognizer = SFSpeechRecognizer(locale: Locale.current)
        recognizer?.delegate = self
        self.speechRecognizer = recognizer
    }

    // MARK: - Authorization

    func requestAuthorization() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            SFSpeechRecognizer.requestAuthorization { _ in
                continuation.resume()
            }
        }

        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            AVAudioApplication.requestRecordPermission { _ in
                continuation.resume()
            }
        }
    }

    // MARK: - Recording

    func startRecording(onResult: @escaping (String) -> Void) {
        guard !isRecording else { return }

        // Cancel any pending task
        recognitionTask?.cancel()
        recognitionTask = nil

        // Configure audio session
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            return
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        recognitionRequest = request

        let inputNode = audioEngine.inputNode
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: inputNode.outputFormat(forBus: 0)) { buffer, _ in
            request.append(buffer)
        }

        guard let recognizer = speechRecognizer, recognizer.isAvailable else {
            return
        }

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            var isFinal = false
            if let result = result {
                let transcript = result.bestTranscription.formattedString
                isFinal = result.isFinal
                if isFinal {
                    onResult(transcript)
                }
            }
            if error != nil || isFinal {
                self?.cleanupAudio()
                Task { @MainActor in
                    self?.isRecording = false
                }
            }
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
            Task { @MainActor in
                self.isRecording = true
            }
        } catch {
            cleanupAudio()
        }
    }

    func stopRecording() {
        recognitionRequest?.endAudio()
        cleanupAudio()
        Task { @MainActor in
            self.isRecording = false
        }
    }

    // MARK: - Private helpers

    private func cleanupAudio() {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest = nil
        recognitionTask = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

// MARK: - SFSpeechRecognizerDelegate

extension SpeechService: SFSpeechRecognizerDelegate {
    func speechRecognizer(_ speechRecognizer: SFSpeechRecognizer, availabilityDidChange available: Bool) {}
}
