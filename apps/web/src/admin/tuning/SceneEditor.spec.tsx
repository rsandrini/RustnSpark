import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { SceneEditor, type SceneData } from './SceneEditor';

const scene = (): SceneData => ({
  id: 'welcome',
  title: { en: 'The welcome', 'pt-BR': 'As boas-vindas' },
  trigger: 'onboarded',
  order: 1,
  start: 'w1',
  nodes: [
    {
      id: 'w1',
      text: { en: 'Hello, pilot.', 'pt-BR': 'Olá, piloto.' },
      position: 'center',
      anchor: null,
      blocking: true,
      next: 'w2',
      choices: [],
    },
    {
      id: 'w2',
      text: { en: 'Your ship.', 'pt-BR': 'Sua nave.' },
      position: 'bottom',
      anchor: 'ship_grid',
      blocking: false,
      next: null,
      choices: [{ label: { en: 'Got it', 'pt-BR': 'Entendi' }, next: null, action: 'end' }],
    },
  ],
});

const renderEditor = (value: unknown, onChange = vi.fn()) =>
  renderWithProviders(<SceneEditor value={value} onChange={onChange} />);

describe('Admin scene editor', () => {
  it('lists the scenes and says when there are none', () => {
    renderEditor([]);
    expect(screen.getByText('No scenes yet.')).toBeInTheDocument();
    renderEditor([scene()]);
    expect(
      screen.getByRole('button', {
        name: /welcome · The ship is built|welcome · The faction is chosen/,
      }),
    ).toBeInTheDocument();
  });

  it("edits a node's text, position and anchor and hands back the whole list", () => {
    const onChange = vi.fn();
    renderEditor([scene()], onChange);
    fireEvent.change(screen.getAllByLabelText('Text (English)')[0]!, {
      target: { value: 'Welcome aboard.' },
    });
    let next = onChange.mock.calls.at(-1)![0] as SceneData[];
    expect(next[0]!.nodes[0]!.text.en).toBe('Welcome aboard.');
    expect(next[0]!.nodes[0]!.text['pt-BR']).toBe('Olá, piloto.');
    fireEvent.change(screen.getAllByLabelText('Where it sits')[1]!, { target: { value: 'right' } });
    next = onChange.mock.calls.at(-1)![0] as SceneData[];
    expect(next[0]!.nodes[1]!.position).toBe('right');
    fireEvent.change(screen.getAllByLabelText('Points at')[0]!, {
      target: { value: 'auto_layout' },
    });
    next = onChange.mock.calls.at(-1)![0] as SceneData[];
    expect(next[0]!.nodes[0]!.anchor).toBe('auto_layout');
    fireEvent.change(screen.getAllByLabelText('Points at')[1]!, { target: { value: '' } });
    next = onChange.mock.calls.at(-1)![0] as SceneData[];
    expect(next[0]!.nodes[1]!.anchor).toBeNull();
  });

  it('adds and removes scenes, nodes and choices; a scene keeps at least one node', () => {
    const onChange = vi.fn();
    renderEditor([scene()], onChange);
    fireEvent.click(screen.getByRole('button', { name: 'Add node' }));
    expect((onChange.mock.calls.at(-1)![0] as SceneData[])[0]!.nodes).toHaveLength(3);
    fireEvent.click(screen.getAllByRole('button', { name: 'Add choice' })[0]!);
    expect((onChange.mock.calls.at(-1)![0] as SceneData[])[0]!.nodes[0]!.choices).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Remove choice' }));
    expect((onChange.mock.calls.at(-1)![0] as SceneData[])[0]!.nodes[1]!.choices).toHaveLength(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove node' })[0]!);
    const afterRemove = onChange.mock.calls.at(-1)![0] as SceneData[];
    expect(afterRemove[0]!.nodes.map((node) => node.id)).toEqual(['w2']);
    expect(afterRemove[0]!.start).toBe('w2');
    fireEvent.click(screen.getByRole('button', { name: 'Remove scene' }));
    expect(onChange.mock.calls.at(-1)![0] as SceneData[]).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Add scene' }));
    expect(onChange.mock.calls.at(-1)![0] as SceneData[]).toHaveLength(2);
  });

  it('offers only what the server accepts: triggers, positions, anchors and actions', () => {
    renderEditor([scene()]);
    const options = (label: string, at = 0) =>
      within(screen.getAllByLabelText(label)[at]!)
        .getAllByRole('option')
        .map((option) => (option as HTMLOptionElement).value);
    expect(options('Starts when')).toEqual([
      'onboarded',
      'ship_built',
      'first_mission_done',
      'first_failure',
      'low_fuel',
      'needs_fuel',
      'ready_for_mission',
      'mission_taken',
      'repair_due',
      'work_due',
      'checklist_done',
      'first_pirates',
      'first_scrap',
      'prologue_gift_enter',
      'prologue_gift_done',
      'prologue_fit-engine_enter',
      'prologue_fit-engine_done',
      'prologue_race-board_enter',
      'prologue_race-board_done',
      'prologue_race_enter',
      'prologue_race_done',
      'prologue_race-report_enter',
      'prologue_race-report_done',
      'prologue_stop-port_enter',
      'prologue_stop-port_done',
      'prologue_choose-job_enter',
      'prologue_choose-job_done',
      'prologue_buy-module_enter',
      'prologue_buy-module_done',
      'prologue_fit-module_enter',
      'prologue_fit-module_done',
      'prologue_dispatch-job_enter',
      'prologue_dispatch-job_done',
      'prologue_job-report_enter',
      'prologue_job-report_done',
      'prologue_upgrade_enter',
      'prologue_upgrade_done',
      'prologue_stop-two_enter',
      'prologue_stop-two_done',
      'prologue_final-board_enter',
      'prologue_final-board_done',
      'prologue_final-run_enter',
      'prologue_final-run_done',
      'prologue_loss_enter',
      'prologue_loss_done',
      'prologue_rescue_enter',
      'prologue_rescue_done',
      'prologue_race_leg_1',
      'prologue_race_leg_2',
      'prologue_race_leg_3',
    ]);
    expect(options('Where it sits')).toEqual(['center', 'bottom', 'left', 'right', 'top']);
    expect(options('Points at')).toContain('port_refuel');
    expect(options('Action')).toContain('goto:/port?tab=refuel');
  });

  it('previews a node the way the pilot sees it', () => {
    renderEditor([scene()]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Preview' })[0]!);
    expect(screen.getByRole('dialog')).toHaveTextContent(/Hello, pilot\./);
    expect(screen.getByTestId('dialogue')).toHaveClass('preview');
  });
});
