import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { PilotAvatar } from './pilot-avatar';

describe('PilotAvatar', () => {
  it('shows the uppercase first letter and is hidden from assistive tech', () => {
    renderWithProviders(<PilotAvatar name="  wren" factionId="luna" size={56} />, {
      withRouter: false,
    });
    const el = screen.getByTestId('pilot-avatar');
    expect(el).toHaveTextContent('W');
    expect(el).toHaveAttribute('aria-hidden', 'true');
  });

  it('rings a known faction in its static colour before the factions load', () => {
    renderWithProviders(<PilotAvatar name="Wren" factionId="luna" />, { withRouter: false });
    expect(screen.getByTestId('pilot-avatar').style.borderColor).toBe('var(--luna)');
  });

  it('is safe for an empty name and an unknown faction', () => {
    renderWithProviders(<PilotAvatar name="" factionId={null} />, { withRouter: false });
    expect(screen.getByTestId('pilot-avatar')).toHaveTextContent('?');
  });
});
