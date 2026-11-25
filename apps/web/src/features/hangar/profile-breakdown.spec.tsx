import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import en from '../../i18n/en.json';
import ptBR from '../../i18n/pt-BR.json';
import type { ShipProfile, ShipProfileDetail } from '../../api/generated';
import { ProfileBreakdown, mainAxis } from './profile-breakdown';

const profile: ShipProfile = {
  cargo: 0.8,
  passengers: 0,
  firepower: 0.1,
  defense: 0.06,
  mobility: 0.1,
  range: 0.1,
  mining: 0,
};
const detail: ShipProfileDetail = {
  cargo: { value: 40, ref: 50 },
  passengers: { value: 0, ref: 20 },
  firepower: { value: 6, ref: 60 },
  defense: { value: 4.2, ref: 70 },
  mobility: { value: 1, ref: 10 },
  range: { value: 5, ref: 50 },
  mining: { value: 0, ref: 30 },
};

function row(name: string): HTMLElement {
  return screen.getByText(name, { selector: '.pb-name' }).closest('li') as HTMLElement;
}

describe('ProfileBreakdown', () => {
  it('shows name, value over reference and percent per axis, plus the help line', () => {
    renderWithProviders(<ProfileBreakdown profile={profile} detail={detail} shipClass="HAULER" />);
    expect(
      screen.getByText(
        "Each bar is the ship's stat over a reference value. The type is the axis that leads.",
      ),
    ).toBeInTheDocument();
    const def = row('Def');
    expect(def).toHaveTextContent('4.2 / 70');
    expect(def).toHaveTextContent('6%');
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
  });

  it('marks the axis that names the type as main and the modifier as second', () => {
    renderWithProviders(
      <ProfileBreakdown
        profile={profile}
        detail={detail}
        shipClass="HAULER"
        profileModifier="firepower"
      />,
    );
    expect(within(row('Cargo')).getByText('main')).toBeInTheDocument();
    expect(within(row('Fire')).getByText('second')).toBeInTheDocument();
    expect(within(row('Def')).queryByText('main')).toBeNull();
  });

  it('a warship is named by whichever of firepower and defense is higher', () => {
    const p = { ...profile, firepower: 0.2, defense: 0.5 };
    expect(mainAxis('WARSHIP', p)).toBe('defense');
    expect(mainAxis('WARSHIP', { ...p, firepower: 0.9 })).toBe('firepower');
    expect(mainAxis('BALANCED', p)).toBeNull();
    expect(mainAxis('TRANSPORT', p)).toBe('passengers');
    expect(mainAxis('MINER', p)).toBe('mining');
    expect(mainAxis('RACER', p)).toBe('mobility');
    renderWithProviders(<ProfileBreakdown profile={p} detail={detail} shipClass="WARSHIP" />);
    expect(within(row('Def')).getByText('main')).toBeInTheDocument();
    expect(within(row('Fire')).queryByText('main')).toBeNull();
  });

  it('marks nothing for a balanced ship', () => {
    renderWithProviders(
      <ProfileBreakdown profile={profile} detail={detail} shipClass="BALANCED" />,
    );
    expect(screen.queryByText('main')).toBeNull();
  });

  it('shows the signed delta against the saved profile when a ghost is given', () => {
    renderWithProviders(
      <ProfileBreakdown
        profile={profile}
        ghost={{ ...profile, cargo: 0.7, defense: 0.1 }}
        detail={detail}
        shipClass="HAULER"
      />,
    );
    const up = within(row('Cargo')).getByText('+10');
    expect(up).toHaveClass('tone-good');
    const down = within(row('Def')).getByText('-4');
    expect(down).toHaveClass('tone-bad');
    expect(within(row('Fire')).queryByText(/^[+-]/)).toBeNull();
  });

  it('shows only the percent when the detail is missing', () => {
    renderWithProviders(<ProfileBreakdown profile={profile} shipClass="HAULER" />);
    expect(row('Cargo')).toHaveTextContent('80%');
    expect(row('Cargo')).not.toHaveTextContent('/');
  });

  it('has pt-BR labels', () => {
    for (const k of ['main', 'second', 'help'] as const) {
      expect(en.hangar.profileBreakdown[k]).toBeTruthy();
      expect(ptBR.hangar.profileBreakdown[k]).toBeTruthy();
    }
    for (const k of ['stats', 'profile', 'label', 'previewChanges'] as const) {
      expect(ptBR.hangar.sheetView[k]).toBeTruthy();
    }
  });

  it('explains what feeds each axis, in both locales', () => {
    const axes = ['cargo', 'passengers', 'firepower', 'defense', 'mobility', 'range', 'mining'];
    for (const tree of [en, ptBR]) {
      const drives = (
        tree as unknown as { hangar: { profileBreakdown: { drives: Record<string, string> } } }
      ).hangar.profileBreakdown.drives;
      for (const axis of axes) expect(drives[axis]).toBeTruthy();
    }
    renderWithProviders(<ProfileBreakdown profile={profile} detail={detail} shipClass="HAULER" />);
    const def = row('Def');
    expect(within(def).getByText(/shield \+ armor/)).toBeInTheDocument();
    expect(within(row('Cargo')).getByText('cargo hold space')).toBeInTheDocument();
    expect(screen.getAllByTestId('pb-type-rule')).toHaveLength(1);
    expect(screen.getByTestId('pb-type-rule')).toHaveTextContent('Range never names a type');
  });

  it('notes on a warship main axis that it takes the higher combat axis', () => {
    renderWithProviders(<ProfileBreakdown profile={profile} detail={detail} shipClass="WARSHIP" />);
    const note = screen.getByTestId('pb-warship-note');
    expect(note).toHaveTextContent('Warship takes its higher combat axis');
    expect(row('Fire')).toContainElement(note);
  });
});
