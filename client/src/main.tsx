import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted fonts (Fontsource): no request to Google, and they ship with the build.
import '@fontsource/goudy-bookletter-1911/400.css';
import '@fontsource-variable/libre-franklin/index.css';
import '@fontsource/special-elite/400.css';
import './styles/tokens.css';
import './styles/global.css';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
