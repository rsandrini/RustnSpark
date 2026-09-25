import '@testing-library/jest-dom/vitest';
import i18n from '../i18n';
import { server } from './msw/server';

const originalError = console.error;
console.error = (...args: unknown[]) => {
  const message = typeof args[0] === 'string' ? args[0] : '';
  if (message.includes('Not implemented: navigation')) {
    return;
  }
  originalError(...args);
};

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  await new Promise<void>((resolve) => {
    if (i18n.isInitialized) {
      resolve();
      return;
    }
    i18n.on('initialized', () => resolve());
  });
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
