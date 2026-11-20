import { createRoot } from 'react-dom/client';
import { App } from '../../ui/App';
import '../../ui/styles.css';
import '../../ui/scheme';

createRoot(document.getElementById('root')!).render(<App layout="panel" />);
