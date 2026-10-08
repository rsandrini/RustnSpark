import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/utils';
import { server } from '../../test/msw/server';
import {
  EncounterPolicyEditor,
  MissionRequirementsEditor,
  NumberMapEditor,
  RelationsEditor,
  ServicesEditor,
  SpecialPropEditor,
  TiersEditor,
} from './StructuredEditors';

describe('structured editors (what used to be raw JSON)', () => {
  it('location services: five labelled checkboxes that read and write the same JSON, keeping unknown keys', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <ServicesEditor
        value={{ buy: true, sell: false, repair: true, custom: 'keep' }}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId('service-buy')).toBeChecked();
    expect(screen.getByTestId('service-sell')).not.toBeChecked();
    expect(screen.getByTestId('service-missions')).not.toBeChecked(); // absent = off
    expect(screen.getByText(/Players can buy parts here/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('service-missions'));
    expect(onChange).toHaveBeenCalledWith({
      buy: true, sell: false, repair: true, custom: 'keep', missions: true,
    });
  });

  it('part special properties: pressurized + life support', () => {
    const onChange = vi.fn();
    renderWithProviders(<SpecialPropEditor value={{ pressurized: true }} onChange={onChange} />);
    expect(screen.getByTestId('special-pressurized')).toBeChecked();
    fireEvent.click(screen.getByTestId('special-lifeSupport'));
    expect(onChange).toHaveBeenCalledWith({ pressurized: true, lifeSupport: true });
  });

  it('encounter policy: a flee checkbox and two selects, writing only what is set', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <EncounterPolicyEditor value={{ missionForcesFlee: true }} onChange={onChange} />,
    );
    expect(screen.getByTestId('policy-missionForcesFlee')).toBeChecked();
    fireEvent.change(screen.getByTestId('policy-preset'), { target: { value: 'ESCAPE' } });
    expect(onChange).toHaveBeenCalledWith({ missionForcesFlee: true, preset: 'ESCAPE' });
  });

  it('mission requirements: check location types and factions from the real lists, set a race entry speed', async () => {
    server.use(
      http.get('/v1/admin/tuning/locations', () =>
        HttpResponse.json([{ id: 'a', type: 'port' }, { id: 'b', type: 'shipyard' }, { id: 'c', type: 'port' }]),
      ),
      http.get('/v1/admin/tuning/factions', () =>
        HttpResponse.json([
          { id: 'luna', displayName: { en: 'Luna Authority', 'pt-BR': 'Autoridade Luna' } },
          { id: 'sun', displayName: { en: 'Sun Syndicate', 'pt-BR': 'Sindicato Sol' } },
        ]),
      ),
    );
    const onChange = vi.fn();
    renderWithProviders(
      <MissionRequirementsEditor
        value={{ originTypes: ['port'], originFactions: ['luna'] }}
        onChange={onChange}
      />,
    );
    const shipyard = await screen.findByTestId('req-type-shipyard');
    expect(screen.getByTestId('req-type-port')).toBeChecked();
    expect(shipyard).not.toBeChecked();
    expect(await screen.findByLabelText('Luna Authority')).toBeChecked();

    fireEvent.click(shipyard);
    expect(onChange).toHaveBeenLastCalledWith({ originTypes: ['port', 'shipyard'], originFactions: ['luna'] });
    // unchecking the last one removes the key: "anywhere" again
    fireEvent.click(screen.getByTestId('req-faction-luna'));
    expect(onChange).toHaveBeenLastCalledWith({ originTypes: ['port'] });
    fireEvent.change(screen.getByTestId('req-minMobility'), { target: { value: '3.5' } });
    expect(onChange).toHaveBeenLastCalledWith({ originTypes: ['port'], originFactions: ['luna'], minMobility: 3.5 });
  });

  it('drop tiers: rows of rarity + percent with a live total that flags anything but 100%', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <TiersEditor
        value={[
          { tier: 'COMMON', chance: 0.6 },
          { tier: 'RARE', chance: 0.3 },
        ]}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId('tier-chance-0')).toHaveValue(60);
    expect(screen.getByTestId('tier-total')).toHaveTextContent('90%');
    expect(screen.getByTestId('tier-total')).toHaveClass('error-text');
    fireEvent.change(screen.getByTestId('tier-chance-1'), { target: { value: '40' } });
    expect(onChange).toHaveBeenCalledWith([
      { tier: 'COMMON', chance: 0.6 },
      { tier: 'RARE', chance: 0.4 },
    ]);
  });

  it('faction relations: a select per OTHER faction that writes into the value', async () => {
    server.use(
      http.get('/v1/admin/tuning/factions', () =>
        HttpResponse.json([
          { id: 'luna', displayName: { en: 'Luna', 'pt-BR': 'Luna' } },
          { id: 'sun', displayName: { en: 'Sun', 'pt-BR': 'Sol' } },
          { id: 'pirates', displayName: { en: 'Pirates', 'pt-BR': 'Piratas' } },
        ]),
      ),
    );
    const onChange = vi.fn();
    renderWithProviders(
      <RelationsEditor rowId="luna" value={{ sun: 'neutral', pirates: 'hostile' }} onChange={onChange} />,
    );
    const select = await screen.findByLabelText('Relation sun');
    expect(screen.queryByLabelText('Relation luna')).toBeNull(); // not itself
    expect(screen.getByLabelText('Relation pirates')).toHaveValue('hostile');
    fireEvent.change(select, { target: { value: 'ally' } });
    expect(onChange).toHaveBeenCalledWith({ sun: 'ally', pirates: 'hostile' });
  });

  it('keeps an advanced raw-JSON fallback that edits the same value', () => {
    const onChange = vi.fn();
    renderWithProviders(<NumberMapEditor value={{ bonus: 2 }} onChange={onChange} />);
    expect(screen.getByLabelText('bonus')).toHaveValue(2);
    const advanced = within(document.body).getByLabelText('Advanced (raw JSON)');
    fireEvent.change(advanced, { target: { value: '{"bonus": 5, "extra": 1}' } });
    expect(onChange).toHaveBeenLastCalledWith({ bonus: 5, extra: 1 });
    fireEvent.change(advanced, { target: { value: '{ nope' } });
    expect(screen.getByText(/invalid json/i)).toBeInTheDocument();
  });
});
