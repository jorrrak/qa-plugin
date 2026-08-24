import { createRoot } from 'react-dom/client';
import '@/assets/tailwind.css';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from sidepanel/index.html');

createRoot(container).render(<App />);
