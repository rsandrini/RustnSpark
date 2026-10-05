import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';
import { ShipStage } from './ShipStage';

const renderStage = (props: Parameters<typeof ShipStage>[0]) =>
  render(
    <I18nextProvider i18n={i18n}>
      <ShipStage {...props} />
    </I18nextProvider>,
  );

// The ship stage shows what the server says the ship is doing: each mode has its own scene, and
// the caption says the same in words (the scene itself is decoration).
describe('ship stage', () => {
  it('flying: stars move and there is no place backdrop', () => {
    renderStage({ mode: 'flying' });
    const scene = screen.getByTestId('transit-scene');
    expect(scene).toHaveClass('moving');
    expect(scene).not.toHaveClass('parked');
    expect(screen.getByTestId('stage-caption')).toHaveTextContent('In flight');
  });

  it('scavenging: wreckage drifts past, but the ship stays parked at the current place (it never travels anywhere)', () => {
    renderStage({ mode: 'scavenging', placeId: 'ceres', placeName: 'Porto Ceres' });
    const scene = screen.getByTestId('transit-scene');
    expect(scene.querySelectorAll('.debris').length).toBeGreaterThan(0);
    expect(scene).toHaveClass('parked');
    expect(scene).not.toHaveClass('moving');
    expect(scene.getAttribute('style')).toContain('/places/ceres.wide.svg');
    expect(screen.getByText('Porto Ceres')).toBeInTheDocument();
    expect(screen.getByTestId('stage-caption')).toHaveTextContent('Scavenging the wreckage');
  });

  it('repairing: drones circle the hull, sparks fly, and the place is the backdrop', () => {
    renderStage({ mode: 'repairing', placeId: 'ceres' });
    const scene = screen.getByTestId('transit-scene');
    expect(scene).toHaveClass('parked');
    expect(scene.querySelectorAll('.drone').length).toBeGreaterThan(0);
    expect(scene.querySelectorAll('.stage-spark').length).toBeGreaterThan(0);
    expect(scene.getAttribute('style')).toContain('/places/ceres.wide.svg');
    expect(screen.getByTestId('stage-caption')).toHaveTextContent('Repairs under way');
  });

  it('docked: parked against the place, no drones, no debris', () => {
    renderStage({ mode: 'idle', placeId: 'hedus', detail: 'Docked at Hedus' });
    const scene = screen.getByTestId('transit-scene');
    expect(scene).toHaveClass('parked');
    expect(scene.querySelector('.drone')).toBeNull();
    expect(scene.querySelector('.debris')).toBeNull();
    expect(screen.getByTestId('stage-caption')).toHaveTextContent('Docked and ready');
    expect(screen.getByTestId('stage-caption')).toHaveTextContent('Docked at Hedus');
  });

  it('is decoration: hidden from assistive technology', () => {
    renderStage({ mode: 'idle' });
    expect(screen.getByTestId('transit-scene')).toHaveAttribute('aria-hidden', 'true');
  });

  // Round-10 owner request: the collapsed placeholder's idle caption ("Docked and ready —
  // Docked at X") duplicates the top bar's own ship status/location exactly — ShipIdentity.tsx
  // shows the identical "Docked at {{place}}" text on every screen already.
  describe('collapsed placeholder bar', () => {
    it('shows nothing extra for idle — the top bar already says it', () => {
      renderStage({ mode: 'idle', placeId: 'hedus', detail: 'Docked at Hedus', collapsed: true });
      expect(screen.queryByTestId('stage-caption')).toBeNull();
    });

    it('still shows the caption for flying — the top bar has no countdown or detail', () => {
      renderStage({ mode: 'flying', until: '2026-01-01T00:00:00.000Z', collapsed: true });
      expect(screen.getByTestId('stage-caption')).toHaveTextContent('In flight');
    });

    it('still shows the caption for repairing — same reason, a live countdown', () => {
      renderStage({
        mode: 'repairing',
        placeId: 'ceres',
        detail: 'in the workshop at Porto Ceres',
        until: '2026-01-01T00:00:00.000Z',
        collapsed: true,
      });
      expect(screen.getByTestId('stage-caption')).toHaveTextContent('Repairs under way');
    });
  });
});
