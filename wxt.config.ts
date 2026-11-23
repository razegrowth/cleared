import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'wxt';

// An optional manifest key from .env (WXT_EXTENSION_KEY) pins the unpacked
// extension's ID, so the OAuth redirect URI registered with Google stays the
// same across machines. Without one, the browser assigns the ID.
const env = Object.fromEntries(
  existsSync('.env')
    ? readFileSync('.env', 'utf8')
        .split('\n')
        .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => [m[1], m[2]])
    : [],
);
const pinned = process.env.WXT_EXTENSION_KEY || env.WXT_EXTENSION_KEY;

export default defineConfig({
  srcDir: 'src',
  // build/glance is the unpacked extension to load; build/cleared-<version>-chrome.zip
  // sits beside it. `pnpm dev` writes build/glance-dev, so the two never collide.
  // The folder keeps the app's old name on purpose: Quo derives an unpacked
  // extension's ID from its folder, and the redirect URI registered with Google uses it.
  outDir: 'build',
  outDirTemplate: 'glance{{modeSuffix}}',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Cleared for Gmail™',
    short_name: 'Cleared',
    description: 'Every Gmail inbox in one calm, keyboard-first list. Read, reply and clear your mail without leaving the tab.',
    ...(pinned ? { key: pinned } : {}),
    minimum_chrome_version: '116',
    permissions: ['storage', 'unlimitedStorage', 'alarms', 'notifications', 'identity', 'sidePanel', 'offscreen'],
    host_permissions: [
      'https://gmail.googleapis.com/*',
      'https://oauth2.googleapis.com/*',
      'https://openidconnect.googleapis.com/*',
    ],
    action: { default_title: 'Cleared' },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+G', mac: 'Alt+Shift+G' },
        description: 'Open Cleared',
      },
      'open-side-panel': {
        suggested_key: { default: 'Alt+Shift+P', mac: 'Alt+Shift+P' },
        description: 'Open Cleared in the side panel',
      },
    },
  },
});
