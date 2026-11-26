import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import en from '../../i18n/en.json';
import ptBR from '../../i18n/pt-BR.json';
import type { ShipProfile } from '../../api/generated';
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

function row(name: string): HTMLElement {
  return screen.getByText(name, { selector: '.pb-name' }).closest('li') as HTMLElement;
}

describe('ProfileBreakdown', () => {
  it('shows name and percent per axis, plus the help line', () => {
    renderWithProviders(<ProfileBreakdown profile={profile} shipClass="HAULER" />);
    // the help line sits behind the "?" tip
    const help =
      "Each bar is the ship's stat over a reference value. The type is the axis that leads.";
    expect(screen.queryByText(help)).toBeNull();
    fireEvent.focus(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(help);
    // the tip sits at the right edge: its card hangs from the button's right edge, not off-screen
    expect(screen.getByRole('tooltip')).toHaveClass('kit-tip-card--end');
    const def = row('Defense');
    expect(def).toHaveTextContent('6%');
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
  });

  it('marks the axis that names the type as main and the modifier as second', () => {
    renderWithProviders(
      <ProfileBreakdown
        profile={profile}

        shipClass="HAULER"
        profileModifier="firepower"
      />,
    );
    expect(within(row('Cargo')).getByText('main')).toBeInTheDocument();
    expect(within(row('War')).getByText('second')).toBeInTheDocument();
    expect(within(row('Defense')).queryByText('main')).toBeNull();
  });

  it('a warship is named by whichever of firepower and defense is higher', () => {
    const p = { ...profile, firepower: 0.2, defense: 0.5 };
    expect(mainAxis('WARSHIP', p)).toBe('defense');
    expect(mainAxis('WARSHIP', { ...p, firepower: 0.9 })).toBe('firepower');
    expect(mainAxis('BALANCED', p)).toBeNull();
    expect(mainAxis('TRANSPORT', p)).toBe('passengers');
    expect(mainAxis('MINER', p)).toBe('mining');
    expect(mainAxis('RACER', p)).toBe('mobility');
    renderWithProviders(<ProfileBreakdown profile={p} shipClass="WARSHIP" />);
    expect(within(row('Defense')).getByText('main')).toBeInTheDocument();
    expect(within(row('War')).queryByText('main')).toBeNull();
  });

  it('marks nothing for a balanced ship', () => {
    renderWithProviders(<ProfileBreakdown profile={profile} shipClass="BALANCED" />);
    expect(screen.queryByText('main')).toBeNull();
  });

  it('shows the signed delta against the saved profile when a ghost is given', () => {
    renderWithProviders(
      <ProfileBreakdown
        profile={profile}
        ghost={{ ...profile, cargo: 0.7, defense: 0.1 }}

        shipClass="HAULER"
      />,
    );
    const up = within(row('Cargo')).getByText('+10');
    expect(up).toHaveClass('tone-good');
    const down = within(row('Defense')).getByText('-4');
    expect(down).toHaveClass('tone-bad');
    expect(within(row('War')).queryByText(/^[+-]/)).toBeNull();
  });

  it('shows no value over reference', () => {
    const { container } = renderWithProviders(
      <ProfileBreakdown profile={profile} shipClass="HAULER" />,
    );
    expect(container.querySelector('.pb-value')).toBeNull();
    expect(row('Defense')).not.toHaveTextContent('4.2 / 70');
    expect(row('Cargo')).toHaveTextContent('80%');
    expect(row('Cargo')).not.toHaveTextContent('/');
  });

  it('writes axis names in full', async () => {
    const names = () => Array.from(document.querySelectorAll('.pb-name')).map((n) => n.textContent);
    const { unmount } = renderWithProviders(<ProfileBreakdown profile={profile} />);
    expect(names()).toEqual(['Cargo', 'Passengers', 'War', 'Defense', 'Speed', 'Range', 'Mining']);
    unmount();
    const i18n = (await import('../../i18n')).default;
    await i18n.changeLanguage('pt-BR');
    try {
      renderWithProviders(<ProfileBreakdown profile={profile} />);
      expect(names()).toEqual([
        'Carga',
        'Passageiros',
        'Guerra',
        'Defesa',
        'Velocidade',
        'Alcance',
        'Mineração',
      ]);
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('lays the row out in tracks that shrink (no fixed em columns)', () => {
    const css = readFileSync(join(__dirname, '../../styles/ship.css'), 'utf8');
    const rule = (sel: string) => {
      const m = new RegExp(`(?:^|\\n)${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css);
      return m?.[1] ?? '';
    };
    expect(rule('.pb-row')).toMatch(/grid-template-columns:\s*16px\s+minmax\(0,\s*1fr\)/);
    expect(css).not.toContain('4.6em');
    expect(rule('.pb-name')).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(rule('.sheet-profile')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
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
    renderWithProviders(<ProfileBreakdown profile={profile} shipClass="HAULER" />);
    const def = row('Defense');
    expect(within(def).getByText(/shield \+ armor/)).toBeInTheDocument();
    expect(within(row('Cargo')).getByText('cargo hold space')).toBeInTheDocument();
    expect(screen.getAllByTestId('pb-type-rule')).toHaveLength(1);
    expect(screen.getByTestId('pb-type-rule')).toHaveTextContent('Range never names a type');
  });

  it('notes on a warship main axis that it takes the higher combat axis', () => {
    renderWithProviders(<ProfileBreakdown profile={profile} shipClass="WARSHIP" />);
    const note = screen.getByTestId('pb-warship-note');
    expect(note).toHaveTextContent('Warship takes its higher combat axis');
    expect(row('War')).toContainElement(note);
  });
});
