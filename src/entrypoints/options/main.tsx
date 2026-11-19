import { createRoot } from 'react-dom/client';
import { SettingsPage } from '../../ui/SettingsPage';
import '../../ui/styles.css';
import '../../ui/settings.css';

createRoot(document.getElementById('root')!).render(<SettingsPage />);
