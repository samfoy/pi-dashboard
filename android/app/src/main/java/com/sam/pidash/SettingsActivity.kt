package com.sam.pidash

import android.os.Bundle
import android.view.MenuItem
import androidx.appcompat.app.AppCompatActivity
import com.sam.pidash.databinding.ActivitySettingsBinding

class SettingsActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySettingsBinding
    private lateinit var config: ServerConfig

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        supportActionBar?.title = "Pi Settings"

        config = ServerConfig(this)
        binding.urlInput.setText(config.baseURL)
        binding.tokenInput.setText(config.token)

        binding.saveButton.setOnClickListener { save() }
    }

    private fun save() {
        val url = binding.urlInput.text?.toString()?.trim() ?: return
        if (url.isEmpty()) {
            binding.urlLayout.error = "Server URL is required"
            return
        }
        binding.urlLayout.error = null
        config.baseURL = url
        config.token = binding.tokenInput.text?.toString()?.trim() ?: ""
        setResult(RESULT_OK)
        finish()
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == android.R.id.home) {
            finish()
            return true
        }
        return super.onOptionsItemSelected(item)
    }
}
