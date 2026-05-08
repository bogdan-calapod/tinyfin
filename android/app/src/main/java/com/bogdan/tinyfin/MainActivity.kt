package com.bogdan.tinyfin

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout

/**
 * Minimal Android TV wrapper for TinyFin.
 *
 * Loads TinyFin from a remote URL in a full-screen WebView with:
 * - JavaScript and DOM storage enabled
 * - Media autoplay (no user gesture required)
 * - Hardware-accelerated video
 * - Full-screen video support (WebChromeClient)
 * - D-pad / remote key events forwarded to the WebView
 * - Back button navigates within the WebView before exiting
 * - Screen stays on while the app is active
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var rootLayout: FrameLayout

    // Full-screen video support
    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null

    companion object {
        /**
         * Set this to the URL where TinyFin is served.
         * For example: "http://192.168.1.100:8096/web/tinyfin/index.html"
         * or any URL where the TinyFin files are hosted.
         */
        private const val TINYFIN_URL = "https://bogdan-calapod.github.io/tinyfin/"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Full-screen immersive mode
        goImmersive()

        // Keep screen on
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Root layout for full-screen video overlay
        rootLayout = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
        }

        // Create and configure WebView
        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            isFocusable = true
            isFocusableInTouchMode = true

            settings.apply {
                // Core
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true

                // Media
                mediaPlaybackRequiresUserGesture = false
                loadWithOverviewMode = true
                useWideViewPort = true

                // Cache for faster reloads
                cacheMode = WebSettings.LOAD_DEFAULT

                // Allow mixed content (HTTP media from HTTPS page if needed)
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

                // Useful for debugging during development
                WebView.setWebContentsDebuggingEnabled(true)
            }

            webViewClient = TinyFinWebViewClient()
            webChromeClient = TinyFinChromeClient()
        }

        rootLayout.addView(
            webView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        setContentView(rootLayout)

        // Load TinyFin
        if (TINYFIN_URL == "CHANGE_ME") {
            webView.loadData(
                """
                <html><body style="background:#000;color:#fff;display:flex;align-items:center;
                justify-content:center;height:100vh;font-family:sans-serif;margin:0">
                <div style="text-align:center">
                <h1>TinyFin</h1>
                <p>Edit <code>MainActivity.kt</code> and set <code>TINYFIN_URL</code><br>
                to the URL where TinyFin is hosted.</p>
                </div></body></html>
                """.trimIndent(),
                "text/html",
                "UTF-8"
            )
        } else {
            webView.loadUrl(TINYFIN_URL)
        }
    }

    /**
     * Back button: navigate back in WebView history, or exit the app.
     */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // If showing full-screen video, exit that first
        if (fullscreenView != null) {
            fullscreenCallback?.onCustomViewHidden()
            return
        }

        // If WebView can go back, do that
        if (webView.canGoBack()) {
            webView.goBack()
            return
        }

        // Otherwise, exit
        @Suppress("DEPRECATION")
        super.onBackPressed()
    }

    /**
     * Forward D-pad and media keys to the WebView.
     * The WebView's JavaScript (tv-navigation.js) handles the actual navigation.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        // Let the WebView handle D-pad and media keys
        if (webView.dispatchKeyEvent(event)) {
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        goImmersive()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    @Suppress("DEPRECATION")
    private fun goImmersive() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )
    }

    /**
     * WebViewClient: keeps all navigation inside the WebView.
     */
    private inner class TinyFinWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            // Stay inside the WebView for all URLs
            return false
        }
    }

    /**
     * WebChromeClient: handles full-screen video and console logging.
     */
    private inner class TinyFinChromeClient : WebChromeClient() {

        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            // A video wants to go full-screen
            fullscreenView = view
            fullscreenCallback = callback

            webView.visibility = View.GONE
            rootLayout.addView(
                view,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                )
            )

            goImmersive()
        }

        override fun onHideCustomView() {
            // Exit full-screen video
            fullscreenView?.let { rootLayout.removeView(it) }
            fullscreenView = null
            fullscreenCallback = null

            webView.visibility = View.VISIBLE
            goImmersive()
        }

        override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
            android.util.Log.d(
                "TinyFin",
                "${consoleMessage.message()} [${consoleMessage.sourceId()}:${consoleMessage.lineNumber()}]"
            )
            return true
        }
    }
}
