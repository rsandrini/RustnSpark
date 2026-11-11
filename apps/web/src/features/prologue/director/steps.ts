import type { SandboxEvent } from '../sandbox/sandbox-state';

/**
 * The steps of the new-pilot opening, in order (the same ids the Admin's scene triggers use). Where the pilot is stays in
 * the browser, per account (the server only knows how the opening ENDED: `Player.prologueOutcome`).
 */
export const OPENING_STEPS = [
  'gift',
  'fit-engine',
  'race-board',
  'race',
  'race-report',
  'stop-port',
  'choose-job',
  'buy-module',
  'fit-module',
  'dispatch-job',
  'job-report',
  'upgrade',
  'stop-two',
  'final-board',
  'final-run',
  'loss',
  'rescue',
] as const;

export type StepId = (typeof OPENING_STEPS)[number];

export const FIRST_STEP: StepId = OPENING_STEPS[0];

export function isStepId(value: unknown): value is StepId {
  return typeof value === 'string' && (OPENING_STEPS as readonly string[]).includes(value);
}

/** The step after `step`, or null when it was the last one (the story is over). */
export function nextStep(step: StepId): StepId | null {
  return OPENING_STEPS[OPENING_STEPS.indexOf(step) + 1] ?? null;
}

/** What each step needs from the screen and from the world; the director reads this table, nothing else. */
export interface StepDef {
  readonly id: StepId;
  /** Where the pilot should be when the step starts (a path, or null = wherever the game took them, like a report). */
  readonly path: string | null;
  /** The nav links the pilot may use. */
  readonly nav: readonly string[];
  /** The only parts of the screen that stay alive (CSS selectors); everything else is inert and dimmed. */
  readonly allow: readonly string[];
  /** The sandbox event that completes the pilot's part (null = nothing to do but listen). */
  readonly until: SandboxEvent['type'] | null;
  /** After the action, wait for the pilot to press Continue (a report to read) instead of moving on at once. */
  readonly confirm: boolean;
  /** A full-screen moment shown on this step (the loss, the rescue). */
  readonly moment?: 'loss' | 'rescue';
}

const NONE: readonly string[] = [];
const YARD = ['.hangar-layout'] as const;

export const STEPS: readonly StepDef[] = [
  { id: 'gift', path: '/ship', nav: ['/ship'], allow: NONE, until: null, confirm: true },
  {
    id: 'fit-engine',
    path: '/ship',
    nav: ['/ship'],
    allow: YARD,
    until: 'layout_saved',
    confirm: false,
  },
  {
    id: 'race-board',
    path: '/missions',
    nav: ['/missions'],
    allow: ['[data-tour="accept_button"]'],
    until: 'accepted',
    confirm: false,
  },
  {
    id: 'race',
    path: '/ship',
    nav: ['/ship'],
    allow: ['[data-tour="dispatch_button"]'],
    until: 'arrived',
    confirm: false,
  },
  { id: 'race-report', path: null, nav: [], allow: NONE, until: null, confirm: true },
  {
    id: 'stop-port',
    path: '/port?tab=refuel',
    nav: ['/port'],
    allow: ['[data-tour="port_refuel"]', '[data-opening="refuel"]'],
    until: 'refuelled',
    confirm: false,
  },
  {
    id: 'choose-job',
    path: '/missions',
    nav: ['/missions'],
    allow: ['[data-opening="choose"]'],
    until: 'chosen',
    confirm: false,
  },
  {
    id: 'buy-module',
    path: '/port?tab=market',
    nav: ['/port'],
    allow: ['[data-opening="market"]'],
    until: 'bought',
    confirm: false,
  },
  {
    id: 'fit-module',
    path: '/ship',
    nav: ['/ship'],
    allow: YARD,
    until: 'layout_saved',
    confirm: false,
  },
  {
    id: 'dispatch-job',
    path: '/missions',
    nav: ['/missions', '/ship'],
    allow: ['[data-tour="accept_button"]', '[data-tour="dispatch_button"]'],
    until: 'arrived',
    confirm: false,
  },
  { id: 'job-report', path: null, nav: [], allow: NONE, until: null, confirm: true },
  {
    id: 'upgrade',
    path: '/port?tab=upgrade',
    nav: ['/port'],
    allow: ['[data-opening="upgrade"]'],
    until: 'upgraded',
    confirm: false,
  },
  {
    id: 'stop-two',
    path: '/missions',
    nav: ['/missions', '/ship'],
    allow: ['[data-tour="accept_button"]', '[data-tour="dispatch_button"]'],
    until: 'arrived',
    confirm: true,
  },
  {
    id: 'final-board',
    path: '/missions',
    nav: ['/missions'],
    allow: ['[data-tour="accept_button"]'],
    until: 'accepted',
    confirm: false,
  },
  {
    id: 'final-run',
    path: '/ship',
    nav: ['/ship'],
    allow: ['[data-tour="dispatch_button"]'],
    until: 'arrived',
    confirm: false,
  },
  { id: 'loss', path: null, nav: [], allow: NONE, until: null, confirm: false, moment: 'loss' },
  { id: 'rescue', path: null, nav: [], allow: NONE, until: null, confirm: true, moment: 'rescue' },
];

export function stepDef(id: StepId): StepDef {
  return STEPS.find((step) => step.id === id) ?? (STEPS[0] as StepDef);
}
