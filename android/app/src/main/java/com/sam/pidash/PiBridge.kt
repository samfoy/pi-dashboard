package com.sam.pidash

import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * Exposed to the web page as `window.__PiBridge`.
 *
 * The JS shim (injected by injectShimAndEinkCSS) translates all
 * `window.webkit.messageHandlers.piX.postMessage(body)` calls into
 * `window.__PiBridge.postMessage('piX', JSON.stringify(body))`.
 *
 * Only the Android-relevant subset is handled here. iOS-only handlers
 * (piHaptic, piLiveActivity*, piSpeak*, piSpeech*) are silently ignored
 * — the shim still intercepts them to prevent JS errors.
 */
class PiBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun postMessage(name: String, bodyJson: String) {
        val body = runCatching { JSONObject(bodyJson) }.getOrDefault(JSONObject())
        activity.runOnUiThread {
            when (name) {
                "piOpenSettings" -> activity.openSettings()

                "piOpenShare" -> activity.handleShare(body)

                "piOpenInSafari" -> {
                    val url = body.optString("url")
                    if (url.isNotEmpty()) activity.openInBrowser(url)
                }

                "piPickMedia" -> activity.launchMediaPicker()

                "piPickFile" -> activity.launchFilePicker()

                "piReady" -> {
                    // Placeholder: dispatch any pending deep-link navigation here in the future
                }

                // Silently ignored on Android:
                // piHaptic        — no haptics on e-ink
                // piSpeech*       — not implemented in v1
                // piSpeak*        — not implemented in v1
                // piSetActiveSlot — iOS notification badge management
                // piLiveActivity* — iOS Live Activities; no Android equivalent
                // piRequestNotificationPermission — not wired in v1
            }
        }
    }
}
