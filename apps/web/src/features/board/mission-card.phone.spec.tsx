import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { MissionCard } from './mission-card';
import type { MissionOffer } from '../../api/generated';

// On a phone the card keeps what decides or monitors a mission and folds the rest behind "Details".
const offer = {
  id: 'm1',
  type: 'DELIVERY',
  status: 'AVAILABLE',
  factionId: 'luna',
  originId: 'ceres',
  destinationId: 'hedus',
  reward: 500,
  rewardEstimate: 500,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  privatePlayerId: null,
  legs: [{ routeId: 'r1' }],
  eligibility: { eligible: false, reasons: [] },
  info: {
    description: { en: 'A long story about the cargo and the sender.', 'pt-BR': 'x' },
    title: { en: 'Luna Delivery', 'pt-BR': 'Entrega' },
    totalDistance: 30,
    legCount: 1,
    estimate: { durationSeconds: 68, fuelNeeded: 2 },
    giver: null,
    material: null,
    race: null,
    cargo: null,
    requirements: [
      { code: 'MIN_CARGO', met: false, message: 'cargo', needed: 5, actual: 2, unit: 'units' },
      { code: 'MIN_POWER', met: true, message: 'power' },
    ],
  },
} as unknown as MissionOffer;

describe('MissionCard on a phone', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width'),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the title, reward, route and what is not met, with the story and checklist inside Details', () => {
    const { container } = renderWithProviders(
      <MissionCard
        offer={offer}
        origin={undefined}
        destination={undefined}
        mine={false}
        actions={null}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Luna Delivery' })).toBeInTheDocument();
    expect(screen.getByTestId('mcard-unmet')).toHaveTextContent('1 requirement(s) not met');
    const details = container.querySelector('details.mcard-more') as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    // the story and the checklist live inside the folded block, not above it
    expect(within(details).getByText(/A long story/)).toBeInTheDocument();
    expect(container.querySelectorAll('.mcard-main > .mcard-desc')).toHaveLength(0);
    expect(container.querySelectorAll('.mcard-main > .mcard-needs')).toHaveLength(0);
  });
});
