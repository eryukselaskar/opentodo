// Lets the page bring the window back from the tray (e.g. when a reminder is clicked)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('todoPlusDesktop', {
  showWindow: () => ipcRenderer.send('show-window'),
});
