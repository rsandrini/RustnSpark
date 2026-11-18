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

/** The list opens closed; most checks look inside the first scene, so open it like the editor does. */
const renderEditor = (value: unknown, onChange = vi.fn(), open = true) => {
  const view = renderWithProviders(<SceneEditor value={value} onChange={onChange} />);
  if (open) {
    const first = screen.queryAllByRole('button', { name: /^\d+\. / })[0];
    if (first !== undefined) fireEvent.click(first);
  }
  return view;
};

describe('Admin scene editor', () => {
  it('lists the scenes and says when there are none', () => {
    renderEditor([]);
    expect(screen.getByText('No scenes yet.')).toBeInTheDocument();
    renderEditor([scene()], vi.fn(), false);
    expect(
      screen.getByRole('button', { name: /^1\. (The ship is built|The faction is chosen)/ }),
    ).toBeInTheDocument();
    // the first words of the scene are beside its heading, to find it in a long list
    expect(screen.getByText(/Hello, pilot\./)).toBeInTheDocument();
  });

  it('lists the scenes in the order they are told, numbered, whatever order they were saved in', () => {
    const at = (id: string, trigger: string, order: number, text: string): SceneData => ({
      ...scene(),
      id,
      trigger,
      order,
      nodes: [{ ...scene().nodes[0]!, text: { en: text, 'pt-BR': text }, next: null }],
      start: 'w1',
    });
    renderEditor(
      [
        at('c', 'prologue_race_leg_2', 1, 'Second leg'),
        at('a', 'prologue_gift_enter', 1, 'First line'),
        at('d', 'prologue_race_done', 1, 'Race over'),
        at('b', 'prologue_race_leg_1', 2, 'Later leg one'),
        at('e', 'prologue_race_leg_1', 1, 'Leg one'),
      ],
      vi.fn(),
      false,
    );
    const headings = screen.getAllByRole('button', { name: /^\d+\. / }).map((b) => b.textContent);
    expect(headings.map((h) => h?.replace(/^\d+\. /, ''))).toEqual([
      'Opening · The gift · when it starts',
      'Opening · The race · end of leg 1',
      'Opening · The race · end of leg 1',
      'Opening · The race · end of leg 2',
      'Opening · The race · when it is done',
    ]);
    expect(headings[0]).toMatch(/^1\. /);
    expect(headings[4]).toMatch(/^5\. /);
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
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    expect((onChange.mock.calls.at(-1)![0] as SceneData[])[0]!.nodes[1]!.choices).toHaveLength(0);
    // asking first: cancelling leaves the node where it was
    const callsBefore = onChange.mock.calls.length;
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove node' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onChange.mock.calls).toHaveLength(callsBefore);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove node' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    const afterRemove = onChange.mock.calls.at(-1)![0] as SceneData[];
    expect(afterRemove[0]!.nodes.map((node) => node.id)).toEqual(['w2']);
    expect(afterRemove[0]!.start).toBe('w2');
    fireEvent.click(screen.getByRole('button', { name: 'Remove scene' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
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
      'prologue_race_leg_1',
      'prologue_race_leg_2',
      'prologue_race_leg_3',
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
      'prologue_repair_enter',
      'prologue_repair_done',
      'prologue_upgrade_enter',
      'prologue_upgrade_done',
      'prologue_stop-two_enter',
      'prologue_stop-two_done',
      'prologue_final-run_enter',
      'prologue_final-run_radar',
      'prologue_final-run_leg_2',
      'prologue_final-run_done',
      'prologue_loss_enter',
      'prologue_loss_done',
      'prologue_rescue_enter',
      'prologue_rescue_done',
      'prologue_later_enter',
      'prologue_later_done',
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
