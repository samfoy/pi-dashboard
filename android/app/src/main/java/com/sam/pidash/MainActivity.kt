package com.sam.pidash

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.view.KeyEvent
import android.view.Menu
import android.view.MenuItem
import android.view.View
import androidx.activity.OnBackPressedCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.sam.pidash.databinding.ActivityMainBinding
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    lateinit var serverConfig: ServerConfig

    // ── Activity result launchers ───────────────────────────────────────────────

    private val settingsLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        serverConfig = ServerConfig(this)
        loadDashboard()
    }

    private val mediaPickerLauncher = registerForActivityResult(
        ActivityResultContracts.GetMultipleContents()
    ) { uris -> uris.forEach { dispatchPickedUri(it, "media-picked") } }

    private val filePickerLauncher = registerForActivityResult(
        ActivityResultContracts.GetMultipleContents()
    ) { uris -> uris.forEach { dispatchPickedUri(it, "file-picked") } }

    // ── Lifecycle ───────────────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(binding.toolbar)

        serverConfig = ServerConfig(this)
        setupWebView()
        loadDashboard()

        binding.retryButton.setOnClickListener { loadDashboard() }

        // Modern back press handling (replaces deprecated onBackPressed)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (binding.webView.canGoBack()) binding.webView.goBack()
                else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    // ── WebView setup ───────────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val wv = binding.webView

        // E-ink: no rubber-band glow on scroll edges
        wv.overScrollMode = WebView.OVER_SCROLL_NEVER
        wv.isScrollbarFadingEnabled = false

        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            mediaPlaybackRequiresUserGesture = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = true
            // UA: base mobile Chrome UA + PiDash-Android tag
            // Frontend checks navigator.userAgent.includes('PiDash-Android') for native features
            userAgentString =
                "Mozilla/5.0 (Linux; Android 13; Boox Palma 2) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 PiDash-Android/1.0"
        }

        // Bridge: web page calls window.__PiBridge.postMessage(name, jsonBody)
        wv.addJavascriptInterface(PiBridge(this), "__PiBridge")

        wv.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                binding.errorView.visibility = View.GONE
                injectShimAndEinkCSS(view)
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                if (request.isForMainFrame) {
                    binding.errorView.visibility = View.VISIBLE
                }
            }
        }

        wv.webChromeClient = WebChromeClient()
    }

    /**
     * Injected once per page load:
     * 1. Shim that translates window.webkit.messageHandlers.piX.postMessage(body)
     *    → window.__PiBridge.postMessage('piX', JSON.stringify(body))
     *    so the iOS-style frontend bridge works without frontend changes.
     * 2. CSS to kill animations/transitions (e-ink ghosting reduction).
     */
    private fun injectShimAndEinkCSS(wv: WebView) {
        val handlers = listOf(
            "piHaptic", "piSetActiveSlot", "piOpenShare", "piOpenInSafari",
            "piRequestNotificationPermission", "piReady", "piPickMedia", "piPickFile",
            "piOpenSettings", "piSpeech", "piSpeechStop", "piLiveActivity",
            "piLiveActivityUpdate", "piLiveActivityEnd", "piSpeak", "piSpeakStop"
        )
        val handlersJs = handlers.joinToString(",") { "'$it'" }

        @Suppress("UnsafeJsEvalExpression")
        val js = """
            (function() {
              if (window.__piShimInstalled) return;
              window.__piShimInstalled = true;

              // iOS bridge shim
              var names = [$handlersJs];
              if (!window.webkit) window.webkit = {};
              if (!window.webkit.messageHandlers) window.webkit.messageHandlers = {};
              names.forEach(function(n) {
                window.webkit.messageHandlers[n] = {
                  postMessage: function(b) {
                    if (window.__PiBridge) {
                      window.__PiBridge.postMessage(n, JSON.stringify(b || {}));
                    }
                  }
                };
              });

              // E-ink: suppress CSS animations and transitions
              var style = document.createElement('style');
              style.textContent = [
                '*, *::before, *::after {',
                '  animation-duration: 0.001ms !important;',
                '  animation-delay: 0s !important;',
                '  transition-duration: 0.001ms !important;',
                '  scroll-behavior: auto !important;',
                '}'
              ].join('\n');
              (document.head || document.documentElement).appendChild(style);
            })();
        """.trimIndent()

        wv.evaluateJavascript(js, null)
    }

    // ── Web ↔ Native dispatch ───────────────────────────────────────────────────

    /** Fire a pi-native CustomEvent on the web page. */
    fun dispatchToWeb(type: String, payload: Map<String, Any> = emptyMap()) {
        val merged = HashMap(payload)
        merged["type"] = type
        val json = JSONObject(merged).toString()
        val js = "window.dispatchEvent(new CustomEvent('pi-native', { detail: $json }))"
        runOnUiThread { binding.webView.evaluateJavascript(js, null) }
    }

    // ── Navigation ──────────────────────────────────────────────────────────────

    fun loadDashboard() {
        binding.errorView.visibility = View.GONE
        binding.webView.loadUrl(serverConfig.baseURL.trimEnd('/') + "/")
    }

    fun openSettings() = settingsLauncher.launch(Intent(this, SettingsActivity::class.java))

    fun openInBrowser(url: String) =
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }

    // ── Share ───────────────────────────────────────────────────────────────────

    fun handleShare(body: JSONObject) {
        val text = body.optString("text", "")
        val urlStr = body.optString("url", "")
        val share = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, if (urlStr.isNotEmpty()) "$text\n$urlStr" else text)
        }
        startActivity(Intent.createChooser(share, null))
    }

    // ── File / media pickers ────────────────────────────────────────────────────

    fun launchMediaPicker() = mediaPickerLauncher.launch("image/*")
    fun launchFilePicker() = filePickerLauncher.launch("*/*")

    private fun dispatchPickedUri(uri: Uri, eventType: String) {
        try {
            val mime = contentResolver.getType(uri) ?: "application/octet-stream"
            val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return
            val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
            val payload = if (eventType == "media-picked") {
                mapOf("data" to b64, "mimeType" to mime, "preview" to "data:$mime;base64,$b64")
            } else {
                mapOf(
                    "name" to (uri.lastPathSegment ?: "file"),
                    "data" to b64,
                    "mimeType" to mime
                )
            }
            dispatchToWeb(eventType, payload)
        } catch (e: Exception) {
            Toast.makeText(this, "Failed to read file: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    // ── Toolbar menu ────────────────────────────────────────────────────────────

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main_menu, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem) = when (item.itemId) {
        R.id.action_back -> {
            if (binding.webView.canGoBack()) binding.webView.goBack()
            true
        }
        R.id.action_refresh -> {
            binding.webView.reload()
            true
        }
        R.id.action_settings -> {
            openSettings()
            true
        }
        else -> super.onOptionsItemSelected(item)
    }

    // ── Physical buttons (Boox volume keys → scroll) ────────────────────────────

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean = when (keyCode) {
        KeyEvent.KEYCODE_VOLUME_DOWN -> {
            binding.webView.scrollBy(0, 400)
            true
        }
        KeyEvent.KEYCODE_VOLUME_UP -> {
            binding.webView.scrollBy(0, -400)
            true
        }
        else -> super.onKeyDown(keyCode, event)
    }


}
