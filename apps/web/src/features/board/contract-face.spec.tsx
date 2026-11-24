import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { renderWithProviders } from '../../test/utils';
import { ContractFace, type ContractFaceProps } from './contract-face';
import type { MissionOffer, WorldLocation } from '../../api/generated';

const ACCEPT = 'Accept';
const LOCKED = 'Locked';

const offer = (over: Partial<MissionOffer> = {}, info: Record<string, unknown> = {}) =>
  ({
    id: 'm1',
    type: 'DELIVERY',
    status: 'AVAILABLE',
    factionId: 'luna',
    originId: 'ceres',
    destinationId: 'hedus',
    reward: 1500,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    privatePlayerId: null,
    legs: [],
    eligibility: { eligible: true, reasons: [] },
    info: {
      title: { en: 'Luna Delivery', 'pt-BR': 'Entrega' },
      description: { en: 'x', 'pt-BR': 'x' },
      totalDistance: 30,
      estimate: { durationSeconds: 120, fuelNeeded: 2 },
      giver: null,
      requirements: [],
      ...info,
    },
    ...over,
  }) as unknown as MissionOffer;

const place = (id: string, risk: 'lo' | 'md' | 'hi', en: string) =>
  ({ id, risk, displayName: { en, 'pt-BR': en } }) as unknown as WorldLocation;

const props = (over: Partial<ContractFaceProps> = {}): ContractFaceProps => ({
  offer: offer(),
  origin: place('ceres', 'lo', 'Ceres'),
  destination: place('hedus', 'md', 'Hedus'),
  taken: false,
  fuel: null,
  burnsFuel: true,
  expired: false,
  actions: <button type="button">{ACCEPT}</button>,
  ...over,
});

const show = (ui: ReactElement) => renderWithProviders(ui);

const unmet = (code: string, extra: Record<string, unknown> = {}) => ({
  code,
  met: false,
  message: code,
  ...extra,
});

describe('ContractFace', () => {
  it('an eligible offer shows the reward, the route, the Accept action and no chips', () => {
    show(<ContractFace {...props()} />);
    expect(screen.getByRole('heading', { name: 'Luna Delivery' })).toBeInTheDocument();
    expect(screen.getByText(/1,500/)).toBeInTheDocument();
    expect(screen.getByText('Ceres')).toBeInTheDocument();
    expect(screen.getByText('Hedus')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByText('Delivery')).toBeInTheDocument();
  });

  it('a blocked offer shows one chip per unmet requirement, with numbers, each leading to its fix', () => {
    const blocked = offer(
      { eligibility: { eligible: false, reasons: [] } },
      {
        requirements: [
          unmet('CARGO_TYPE', { needed: 5, actual: 2, unit: 'units' }),
          unmet('WEAPONS'),
          unmet('SOMETHING_NEW'),
          { code: 'MIN_POWER', met: true, message: 'power' },
        ],
      },
    );
    show(
      <ContractFace {...props({ offer: blocked, actions: <button disabled>{LOCKED}</button> })} />,
    );
    expect(screen.getByRole('button', { name: 'Locked' })).toBeDisabled();
    const chips = within(screen.getByRole('group'));
    expect(chips.getAllByText(/./, { selector: '.kit-blocker' })).toHaveLength(3);
    const cargo = chips.getByRole('link', { name: /Cargo/ });
    expect(cargo).toHaveAttribute('href', '/ship?store=CARGO');
    expect(cargo).toHaveTextContent(/2.*5/);
    expect(chips.getByRole('link', { name: /eapon/ })).toHaveAttribute(
      'href',
      '/ship?store=WEAPON',
    );
    // an unknown code has no single fix: a plain chip, not a link
    expect(chips.getAllByRole('link')).toHaveLength(2);
    expect(chips.getByText(/SOMETHING_NEW/)).toBeInTheDocument();
  });

  it('adds the reasons the checklist does not name, without repeating the ones it does', () => {
    const blocked = offer(
      {
        eligibility: {
          eligible: false,
          reasons: [
            { code: 'WEAPONS', message: 'weapons' },
            { code: 'NO_BRIDGE', message: 'no bridge' },
          ],
        },
      },
      { requirements: [unmet('WEAPONS')] },
    );
    show(<ContractFace {...props({ offer: blocked })} />);
    const chips = screen.getByRole('group').querySelectorAll('.kit-blocker');
    expect(chips).toHaveLength(2);
    expect(screen.getByRole('link', { name: /bridge/i })).toHaveAttribute('href', '/ship');
  });

  it('says the risk in words for assistive tech', () => {
    show(<ContractFace {...props()} />);
    expect(screen.getByRole('img', { name: 'Medium risk' })).toBeInTheDocument();
  });

  it('with no giver shows the faction badge and no broken image', () => {
    const { container } = show(<ContractFace {...props()} />);
    expect(container.querySelector('.mrow-giver .fac')).not.toBeNull();
    expect(container.querySelector('img[src=""]')).toBeNull();
  });

  it('shows the giver when there is one', () => {
    const giver = {
      id: 'g',
      name: 'Ines Moura',
      title: { en: 'Dispatcher', 'pt-BR': 'Despachante' },
      role: 'GIVER',
      factionId: 'luna',
      portraitUrl: null,
    };
    show(<ContractFace {...props({ offer: offer({}, { giver }) })} />);
    expect(screen.getByText('Ines Moura')).toBeInTheDocument();
  });

  it('a taken offer keeps its tag, status and countdown, and no chips', () => {
    const taken = offer(
      { status: 'ACCEPTED', eligibility: { eligible: false, reasons: [] } },
      { requirements: [unmet('WEAPONS')] },
    );
    show(<ContractFace {...props({ offer: taken, taken: true, tag: 'Your mission' })} />);
    expect(screen.getByText('Your mission')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.getByText(/Start before/)).toBeInTheDocument();
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('an expired offer says so', () => {
    show(<ContractFace {...props({ expired: true })} />);
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('shows the fuel chip, as a link to the refuel tab, when fuel is short', () => {
    const fuel = { state: 'short', have: 1, needed: 5, cap: 10, missing: 4, scale: 10 } as const;
    show(<ContractFace {...props({ fuel })} />);
    const chip = screen.getByTestId('fuel-chip');
    expect(chip).toHaveAttribute('data-state', 'short');
    expect(chip).toHaveAttribute('href', '/port?tab=refuel');
  });

  it('sends a trip bigger than the tank to the tank store', () => {
    const fuel = { state: 'tank', have: 1, needed: 50, cap: 10, missing: 49, scale: 50 } as const;
    show(<ContractFace {...props({ fuel })} />);
    expect(screen.getByTestId('fuel-chip')).toHaveAttribute('href', '/ship?store=TANK');
  });

  it('tells a trip longer than the tank once: the fuel chip, not also the capacity requirement', () => {
    const blocked = offer(
      { eligibility: { eligible: false, reasons: [] } },
      { requirements: [unmet('FUEL_CAPACITY', { needed: 9, actual: 5, unit: 'fuel' })] },
    );
    show(
      <ContractFace
        {...props({
          offer: blocked,
          fuel: { state: 'tank', missing: 4 } as ContractFaceProps['fuel'],
        })}
      />,
    );
    const chips = screen.getByRole('group').querySelectorAll('.kit-blocker');
    expect(chips).toHaveLength(1);
    expect(screen.getByTestId('fuel-chip')).toBeInTheDocument();
  });

  it('hides the route arrow from assistive tech', () => {
    const { container } = show(<ContractFace {...props()} />);
    expect(container.querySelector('.mrow-arrow')).toHaveAttribute('aria-hidden', 'true');
  });
});
