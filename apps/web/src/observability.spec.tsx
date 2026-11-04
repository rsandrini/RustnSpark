import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from './test/utils';
import { CrashScreen } from './app/crash-screen';
import { initObservability } from './observability';

describe('error tracking in the browser', () => {
  it('stays off without a DSN at build time (dev, tests and CI send nothing)', () => {
    expect(initObservability()).toBe(false);
  });

  it('the crash screen tells the pilot to reload', () => {
    renderWithProviders(<CrashScreen />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
