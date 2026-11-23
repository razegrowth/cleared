import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// A browser page that runs Cleared's UI and background code together, with
// chrome.* faked in memory and the sample mailbox loaded. For working on the
// UI without loading the extension: pnpm preview, then open
//   /?layout=popup | /?layout=panel | /?layout=settings   (&theme=dark, &empty)
export default defineConfig({
  root: 'preview',
  publicDir: '../public',
  plugins: [react()],
  server: { port: 5199, strictPort: true },
});
