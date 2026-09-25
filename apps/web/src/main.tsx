import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/app';
import './i18n';
import './styles/index.css';

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
