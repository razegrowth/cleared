import { defineConfig } from 'wxt';

// The public half of .keys/glance.pem. It pins the extension ID to
// aiiajjnmbdmphlgpjonnpffadapdiegl in every browser and on every machine,
// so the OAuth redirect URI registered with Google never changes.
const KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1sYDwamzy0dqAeg4u6bTWxuyZ4bifbyY7FjfKV/GEKnV7ND/nZSV5/71ufDQ3HkvIaCHvR3Ltwfr0930HTQ7kBaC/DUmtY4WnHddOe9b3zUP7SNPHV54Bg5OcVZPrmAWIe/2f25qvSIIr+GqkePu0Dz4WJ9es46XiaOtU4gf2lgek7DKrScIOa65OtEUvi3Pnsh0cG73eLJJpzx/tYw7ktLrGJ9B3P8xB93YGDDjdoSYsNEjRSc9Q6JDJIubnR/bexrCdbohLlewZH0rLFmgfKRAWDRBdNgR4YrG8mWhqrCefdLvLMv8Qur6vhBA7F4mKdJ9cXvjwJgx5jcMv5l1gwIDAQAB';

export default defineConfig({
  srcDir: 'src',
  // build/glance is the unpacked extension to load; build/glance-<version>-chrome.zip
  // sits beside it. `pnpm dev` writes build/glance-dev, so the two never collide.
  outDir: 'build',
  outDirTemplate: 'glance{{modeSuffix}}',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Glance',
    description: 'All your Gmail inboxes, one calm glance away.',
    key: KEY,
    minimum_chrome_version: '116',
    permissions: ['storage', 'unlimitedStorage', 'alarms', 'notifications', 'identity', 'sidePanel', 'offscreen'],
    host_permissions: [
      'https://gmail.googleapis.com/*',
      'https://oauth2.googleapis.com/*',
      'https://openidconnect.googleapis.com/*',
    ],
    action: { default_title: 'Glance' },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+G', mac: 'Alt+Shift+G' },
        description: 'Open Glance',
      },
      'open-side-panel': {
        suggested_key: { default: 'Alt+Shift+P', mac: 'Alt+Shift+P' },
        description: 'Open Glance in the side panel',
      },
    },
  },
});
