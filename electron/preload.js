const { contextBridge, shell } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url) => shell.openExternal(url),
});

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', (event) => {
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href) return;
    if (/^https?:/i.test(href)) {
      event.preventDefault();
      shell.openExternal(href);
    }
  });
});
