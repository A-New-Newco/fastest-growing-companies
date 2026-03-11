import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './AppDashboard';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Popup root element not found.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
