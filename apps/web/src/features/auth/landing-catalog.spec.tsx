import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { ShipClasses, MissionKinds } from './landing-catalog';

describe('ShipClasses', () => {
  it('renders the heading and five class cards', () => {
    renderWithProviders(<ShipClasses />);

    expect(
      screen.getByRole('heading', { name: 'Different ships, different jobs' }),
    ).toBeInTheDocument();

    const list = screen.getByRole('list');
    const items = list.querySelectorAll('li');
    expect(items).toHaveLength(5);

    const names = ['Hauler', 'Transport', 'Warship', 'Miner', 'Multirole'];
    for (const name of names) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }

    expect(screen.getByText(/Mostly cargo holds/i)).toBeInTheDocument();
    expect(screen.getByText(/Pressurized cabins/i)).toBeInTheDocument();
    expect(screen.getByText(/Weapons and defense first/i)).toBeInTheDocument();
    expect(screen.getByText(/A mining rig on board/i)).toBeInTheDocument();
    expect(screen.getByText(/No single specialty/i)).toBeInTheDocument();
  });
});

describe('MissionKinds', () => {
  it('renders the heading and eight mission cards with needs labels', () => {
    renderWithProviders(<MissionKinds />);

    expect(screen.getByRole('heading', { name: 'A mission for every ship' })).toBeInTheDocument();

    const list = screen.getByRole('list');
    const items = list.querySelectorAll('li');
    expect(items).toHaveLength(8);

    const names = [
      'Delivery',
      'Transport',
      'Escort',
      'Mining',
      'Rescue',
      'Race',
      'Scavenge',
      'Travel',
    ];
    for (const name of names) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }

    const needsLabels = screen.getAllByText('Needs');
    expect(needsLabels).toHaveLength(6);

    const ownLabels = screen.getAllByText('You start it');
    expect(ownLabels).toHaveLength(2);

    expect(screen.getByText('A Mining Rig and cargo space for the ore.')).toBeInTheDocument();
  });

  it('uses the same card class for all eight missions', () => {
    renderWithProviders(<MissionKinds />);
    const list = screen.getByRole('list');
    const cards = list.querySelectorAll('li');
    const classNames = [...cards].map((card) => card.className);
    expect(new Set(classNames).size).toBe(1);
  });
});
