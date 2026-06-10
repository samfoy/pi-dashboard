package com.sam.pidash

import android.content.Context

/**
 * SharedPreferences-backed server configuration.
 * Mirrors the iOS ServerConfig's key settings (base URL + auth token).
 */
class ServerConfig(context: Context) {

    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    var baseURL: String
        get() = prefs.getString(KEY_BASE_URL, DEFAULT_BASE_URL) ?: DEFAULT_BASE_URL
        set(value) = prefs.edit().putString(KEY_BASE_URL, value).apply()

    companion object {
        const val DEFAULT_BASE_URL = "http://samuels-macbook-air-1.taile86245.ts.net:7777"
        private const val PREFS_NAME = "pidash_prefs"
        private const val KEY_BASE_URL = "base_url"
    }
}
