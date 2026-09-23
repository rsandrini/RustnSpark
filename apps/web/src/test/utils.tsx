import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import type { ReactElement } from 'react';
import type { RouteObject } from 'react-router-dom';
import i18n from '../i18n';

export function renderWithProviders(
  ui: ReactElement,
  options: {
    initialEntries?: string[];
    withRouter?: boolean;
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapRouter = options.withRouter ?? true;

  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        {wrapRouter ? (
          <MemoryRouter initialEntries={options.initialEntries ?? ['/']}>
            {ui}
          </MemoryRouter>
        ) : (
          ui
        )}
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

export function renderWithRouter(
  routes: RouteObject[],
  options: { initialEntries?: string[] } = {},
) {
  const router = createMemoryRouter(routes, {
    initialEntries: options.initialEntries ?? ['/'],
  });
  return renderWithProviders(<RouterProvider router={router} />, {
    withRouter: false,
  });
}
