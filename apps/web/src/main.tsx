import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/app';
import './i18n';
import '@fontsource/geist/latin-400.css';
import '@fontsource/geist/latin-500.css';
import '@fontsource/geist/latin-600.css';
import '@fontsource/geist-mono/latin-400.css';
import '@fontsource/geist-mono/latin-500.css';
import '@fontsource/instrument-serif/latin-400.css';
import './styles/index.css';
import './styles/components.css';
import './styles/shell.css';
import './styles/port.css';
import './styles/missions.css';
import './styles/map.css';
import './styles/profile.css';
import './styles/onboarding.css';
import './styles/auth.css';
import './styles/report.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

// One client for the whole shell: the admin screens (useQuery) and every game screen
// (S10.x) share it — previously only the test harness provided one, so any real
// useQuery call would have thrown outside tests.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
