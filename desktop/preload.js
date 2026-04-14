// Preload script — exposes safe APIs to the renderer
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('piDash', {
  platform: process.platform,
})
