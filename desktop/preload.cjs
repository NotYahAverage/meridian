// Exposes the native bridge the game looks for (see src/platform/Platform.ts).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meridianNative', {
  storage: {
    list: () => ipcRenderer.invoke('saves:list'),
    save: (id, data, thumbnail) => ipcRenderer.invoke('saves:save', id, data, thumbnail),
    load: (id) => ipcRenderer.invoke('saves:load', id),
    remove: (id) => ipcRenderer.invoke('saves:remove', id),
  },
  quit: () => ipcRenderer.send('app:quit'),
  onCloseRequested: (cb) => ipcRenderer.on('app:close-requested', () => cb()),
  setFullscreen: (on) => ipcRenderer.send('app:fullscreen', !!on),
  isFullscreen: () => ipcRenderer.invoke('app:is-fullscreen'),
});
