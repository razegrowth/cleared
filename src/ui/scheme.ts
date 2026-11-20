/**
 * Tells the background whether the browser looks light or dark, so the
 * toolbar eye can match. Pages that load this report once and on every change.
 */
const query = window.matchMedia?.('(prefers-color-scheme: dark)');

function report() {
  if (!query) return;
  try {
    Promise.resolve(chrome.runtime.sendMessage({ type: 'colorScheme', dark: query.matches })).catch(() => {});
  } catch {
    // No extension context (the local preview).
  }
}

report();
query?.addEventListener?.('change', report);
