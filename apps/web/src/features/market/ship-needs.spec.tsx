import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import en from '../../i18n/en.json';
import ptBR from '../../i18n/pt-BR.json';
import type { ShipSheet } from '../../api/generated';
import {
  ShipNeedsList,
  ShipNeedsNote,
  isShield,
  lackingParts,
  useDismissedNeeds,
  type ShipNeed,
} from './ship-needs';

const sheet = { pdf: 5, bli: 3, esc: 0, energyCont: 1, crg: 4 } as unknown as ShipSheet;
const part = (partClass: string, partType: string) => ({
  id: partType,
  displayName: { en: partType, 'pt-BR': partType },
  catalog: { partClass, partType, w: 1, h: 1 },
});
const ids = (installed: ReturnType<typeof part>[]) =>
  lackingParts(sheet, installed).map((need) => need.id);

describe('lackingParts: the recommended shield and battery', () => {
  it('asks for both when the ship has neither', () => {
    expect(ids([part('ENGINE', 'engine_chem_small')])).toEqual(['shield', 'battery']);
  });

  it('a shield is a DEFENSE part told apart by its family name: armor does not count as one', () => {
    expect(isShield({ partClass: 'DEFENSE', partType: 'shield_basic' })).toBe(true);
    expect(isShield({ partClass: 'DEFENSE', partType: 'shield_large_rare' })).toBe(true);
    expect(isShield({ partClass: 'DEFENSE', partType: 'armor_plate' })).toBe(false);
    expect(ids([part('DEFENSE', 'armor_plate')])).toContain('shield');
  });

  it('an installed shield and an installed battery clear the tip, whatever their rarity', () => {
    expect(ids([part('DEFENSE', 'shield_basic'), part('BATTERY', 'battery_small')])).toEqual([]);
    expect(
      ids([part('DEFENSE', 'shield_medium_epic'), part('BATTERY', 'battery_bank_rare')]),
    ).toEqual([]);
  });

  it('asks only for what is missing', () => {
    expect(ids([part('DEFENSE', 'shield_basic')])).toEqual(['battery']);
    expect(ids([part('BATTERY', 'battery_small')])).toEqual(['shield']);
  });
});

const need = (id: string): ShipNeed => ({ id, partClass: 'WEAPON' });
const TOGGLE = 'toggle';
const IDS = ['weapon', 'defense', 'shield', 'battery', 'power', 'cargo'];

describe('ShipNeedsList chips', () => {
  beforeEach(() => localStorage.clear());

  it('renders one chip per need with its short label and the missing kind icon', () => {
    render(
      <ShipNeedsList
        needs={[need('weapon'), need('shield')]}
        onShow={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const group = screen.getByRole('group', { name: 'Your ship needs' });
    for (const label of ['No weapon', 'No shield']) {
      const chip = within(group).getByRole('button', { name: label });
      expect(chip.querySelector('svg')).not.toBeNull();
    }
    expect(group.querySelector('ul')).toBeNull();
  });

  it('clicking the chip calls onShow with that need', async () => {
    const onShow = vi.fn();
    const weapon = need('weapon');
    render(<ShipNeedsList needs={[weapon]} onShow={onShow} onDismiss={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'No weapon' }));
    expect(onShow).toHaveBeenCalledWith(weapon);
  });

  it('renders nothing without needs', () => {
    const { container } = render(<ShipNeedsList needs={[]} onShow={vi.fn()} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('five needs: four chips and a +1 chip that opens the first hidden need', async () => {
    const onShow = vi.fn();
    const needs = ['weapon', 'defense', 'shield', 'battery', 'power'].map(need);
    render(<ShipNeedsList needs={needs} onShow={onShow} onDismiss={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Low power' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '+1' }));
    expect(onShow).toHaveBeenCalledWith(needs[4]);
    expect(screen.getAllByRole('button', { name: /^Dismiss/ })).toHaveLength(4);
  });
});

function Harness({ onShow = vi.fn() }: { onShow?: (c: string) => void }) {
  const [on, setOn] = useState(true);
  return (
    <>
      <button onClick={() => setOn(!on)}>{TOGGLE}</button>
      {on && <Dismissable onShow={onShow} />}
    </>
  );
}
function Dismissable({ onShow }: { onShow: (c: string) => void }) {
  const [dismissed, dismiss] = useDismissedNeeds();
  const needs = [need('weapon'), need('cargo')].filter((n) => !dismissed.has(n.id));
  return <ShipNeedsList needs={needs} onShow={(n) => onShow(n.partClass)} onDismiss={dismiss} />;
}

describe('dismissing a need chip', () => {
  beforeEach(() => localStorage.clear());

  it('calls onDismiss, hides the chip and stays dismissed after a remount', async () => {
    const onDismiss = vi.fn();
    const first = render(
      <ShipNeedsList needs={[need('weapon')]} onShow={vi.fn()} onDismiss={onDismiss} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss: No weapon' }));
    expect(onDismiss).toHaveBeenCalledWith(need('weapon'));
    first.unmount();

    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss: No weapon' }));
    expect(screen.queryByRole('button', { name: 'No weapon' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(screen.queryByRole('button', { name: 'No weapon' })).toBeNull();
    expect(screen.getByRole('button', { name: 'No cargo hold' })).toBeInTheDocument();
  });
});

describe('ShipNeedsNote', () => {
  beforeEach(() => localStorage.clear());
  const lacking = { pdf: 0, bli: 3, esc: 0, energyCont: 1, crg: 4 } as unknown as ShipSheet;
  it('shows chips in port and is hidden when the ship cannot shop', () => {
    const { rerender } = render(
      <ShipNeedsNote sheet={lacking} installedParts={[]} canShop onShow={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'No weapon' })).toBeInTheDocument();
    rerender(
      <ShipNeedsNote sheet={lacking} installedParts={[]} canShop={false} onShow={vi.fn()} />,
    );
    expect(screen.queryByTestId('ship-needs')).toBeNull();
  });
});

describe('need chip locale keys', () => {
  it('en and pt-BR have a short label for every need lackingParts can emit', () => {
    for (const locale of [en, ptBR]) {
      const chips = (locale as unknown as { market: { needChip: Record<string, string> } }).market
        .needChip;
      for (const id of IDS) expect(chips[id], id).toBeTruthy();
    }
  });
});
