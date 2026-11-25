import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { PlacesDrawer } from './places-drawer';

describe('PlacesDrawer', () => {
  it('keeps the help tip next to the title, in its own row', () => {
    renderWithProviders(
      <PlacesDrawer places={[]} onSelect={() => undefined} onClose={() => undefined} />,
    );
    const title = screen.getByRole('heading', { level: 2 });
    const tip = screen.getByRole('button', { name: 'Help' });
    expect(title.parentElement).toHaveClass('map-panel-titlerow');
    expect(title.parentElement).toContainElement(tip);
    fireEvent.focus(tip);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });
});
