// Bridge exposed by electron/preload.cjs; undefined in the browser
interface Window {
  todoPlusDesktop?: { showWindow: () => void };
}
