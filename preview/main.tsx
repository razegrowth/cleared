import './chrome-shim';
import { createRoot } from 'react-dom/client';
import { attachRouter } from './chrome-shim';
import { respond } from '../src/background/router';
import { App } from '../src/ui/App';
import { SettingsPage } from '../src/ui/SettingsPage';
import '../src/ui/styles.css';
import '../src/ui/settings.css';

const params = new URLSearchParams(location.search);
const layout = params.get('layout') ?? 'popup';
const theme = params.get('theme');

attachRouter((req) => respond(req as never));
document.body.className = layout === 'settings' ? 'settings' : layout === 'popup' ? 'popup' : 'panel';
if (layout === 'popup') document.body.style.cssText = 'margin: 24px; box-shadow: 0 10px 40px rgba(0,0,0,.18); border-radius: 10px;';

async function boot() {
  if (theme) await respond({ type: 'updateSettings', patch: { theme: theme as 'light' | 'dark' } });
  if (!params.has('empty')) await respond({ type: 'addDemo' });
  createRoot(document.getElementById('root')!).render(
    layout === 'settings' ? <SettingsPage /> : <App layout={layout === 'popup' ? 'popup' : 'panel'} />,
  );
}
boot();
