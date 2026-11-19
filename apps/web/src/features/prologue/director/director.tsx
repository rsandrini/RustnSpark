import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  client,
  holdClock,
  resetClockHold,
  resumeClock,
  serverNow,
  setApiInterceptor,
} from '../../../api/client';
import { DialogueBox } from '../../dialogue/dialogue-box';
import { useAuth } from '../../auth/auth.hooks';
import { usePrologueMode } from '../prologue-mode';
import { forgetStep, usePrologueStep, writeKind, writeStep } from '../prologue-state';
import { SkipWarning } from '../skip-warning';
import { moduleKindOf } from '../sandbox/sandbox-offers';
import { modulesFor } from '../sandbox/sandbox-world';
import { previewOf } from '../sandbox/sandbox-ship';
import { UPGRADE_SCRAP } from '../sandbox/sandbox-world';
import type { Sandbox, SandboxEvent } from '../sandbox/sandbox-state';
import {
  doneOf,
  enterOf,
  finalLegOf,
  radarOf,
  legOf,
  scenesFor,
  startNode,
  type Moment,
  type Spoken,
} from './lines';
import { useOpeningLocks } from './locks';
import {
  holdForResultCard,
  releaseUnlessCardShown,
  useResultCardHeld,
} from '../../report/result-card-gate';
import { DarkMoment, LaterMoment, RescueMoment } from './moments';
import { liftCurtain, raiseCurtain } from '../curtain';
import { nextStep, stepDef, type StepDef, type StepId } from './steps';
import './director.css';

type Phase = 'enter' | 'act' | 'leave';

/** What the director tracks for the step the pilot is on. */
interface Run {
  readonly step: StepId;
  readonly phase: Phase;
  /** The pilot did the step's one thing. */
  readonly satisfied: boolean;
  /** The step's picture (the loss, the rescue) has played, so the guide may speak. */
  readonly momentReady: boolean;
  /** The scenes waiting to be spoken, the first one is on the screen. */
  readonly queue: readonly Spoken[];
}
type Outcome = 'played' | 'skipped';

const NO_ZONES: readonly string[] = [];
const DARK_STEPS: readonly StepId[] = ['loss', 'rescue', 'later'];
const noop = () => undefined;
const MS = 1000;
/** How often the story looks at the clock. */
const TICK_MS = 100;
/** Did the pilot's save leave a ship the step is happy with (the engine fitted, the module fitted, nothing broken)? */
function fitted(sandbox: Sandbox, step: StepId): boolean {
  const preview = previewOf(sandbox, sandbox.state.layout);
  if (!preview.viability.viable) return false;
  // a ship that can fly has its engine; the second fitting is done when the module is on it too
  return step === 'fit-engine' || moduleKindOf(sandbox) !== null;
}

/** Has the pilot bought every part the job they chose needs? */
function moduleBought(sandbox: Sandbox): boolean {
  const kind = sandbox.state.chosen;
  if (kind === null) return false;
  const owned = new Set(sandbox.state.parts.map((entry) => entry.part.catalog.partType));
  return modulesFor(kind).every((part) => owned.has(part.catalog.partType));
}

/** Does `event` finish the pilot's part of `def`? */
function completes(def: StepDef, event: SandboxEvent, sandbox: Sandbox): boolean {
  if (def.until === null || event.type !== def.until) return false;
  if (def.until === 'layout_saved') return fitted(sandbox, def.id);
  // a passenger job's modules are two parts (the cabin and its life support): the step is done when the last one is bought
  if (def.until === 'bought') return moduleBought(sandbox);
  // the workshop may be paid for a part of the parts: the step is done when nothing on the ship is worn any more
  if (def.until === 'repaired') return sandbox.wornParts().length === 0;
  return true;
}

/** One scene, one line at a time, in the game's dialogue box. It ends when its last line is read (or skipped). */
function Speaker({ spoken, onDone }: { spoken: Spoken; onDone: () => void }) {
  const [nodeId, setNodeId] = useState(() => startNode(spoken.scene)?.id ?? null);
  const node = spoken.scene.nodes.find((entry) => entry.id === nodeId) ?? null;
  // a scene whose lines were removed (or point nowhere) must never hold the pilot
  useEffect(() => {
    if (node === null) onDone();
  }, [node, onDone]);
  if (node === null) return null;
  const goTo = (next: string | null) => (next === null ? onDone() : setNodeId(next));
  return (
    <DialogueBox
      key={`${spoken.key}:${node.id}`}
      giver={spoken.giver}
      node={node}
      onContinue={() => goTo(node.next)}
      onChoose={(choice) => goTo(choice.next)}
      onSkip={onDone}
      endLabel="continue"
    />
  );
}

/**
 * The story on the real screens. It knows which step the pilot is on, takes them to the right screen, locks everything
 * but the step's one action, speaks the guides' lines (from the Admin) when a step starts, ends, or a race leg is done,
 * and moves on when the sandbox says the pilot did the thing. The pilot can skip the whole opening at any moment.
 */
export function Director() {
  const { t } = useTranslation();
  const opening = usePrologueMode();
  const { sandbox, guides, setAllowedPaths } = opening;
  const { user, reloadProfile } = useAuth();
  const playerId = user?.id;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const step = usePrologueStep(playerId);
  const def = stepDef(step);

  // Everything that belongs to the step the pilot is on lives in one record, tagged with its step: a render that has just
  // moved to a new step never sees the last step's state (no step can finish on what the previous one did).
  const fresh = useCallback(
    (id: StepId): Run => ({
      step: id,
      phase: 'enter',
      satisfied: stepDef(id).until === null,
      momentReady: stepDef(id).moment === undefined,
      queue: scenesFor(guides, enterOf(id)),
    }),
    [guides],
  );
  const [stored, setStored] = useState<Run>(() => fresh(step));
  const run = stored.step === step ? stored : fresh(step);
  const { phase, satisfied, momentReady, queue } = run;
  const [warning, setWarning] = useState(false);
  // the pirates have struck: the screen starts going black with Bob's first line, and stays black through the loss
  const [struck, setStruck] = useState(false);
  // the rescue cutter has flown off
  const [departed, setDeparted] = useState(false);
  const cutterGone = useCallback(() => setDeparted(true), []);
  // the mission's result card comes before the guide's lines
  const resultCardHeld = useResultCardHeld();

  const queryClient = useQueryClient();
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const stepRef = useRef(step);
  stepRef.current = step;
  const update = useCallback(
    (change: (current: Run) => Run) =>
      setStored((previous) =>
        change(previous.step === stepRef.current ? previous : fresh(stepRef.current)),
      ),
    [fresh],
  );
  useEffect(() => {
    if (stored.step !== step) setStored(fresh(step));
  }, [stored.step, step, fresh]);

  const defRef = useRef(def);
  defRef.current = def;
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const finish = useMutation({
    mutationFn: (outcome: Outcome) => client.post('/v1/players/me/prologue', { outcome }),
    // the story could not be saved: the curtain the ending raised must not hold the screen black
    onError: () => liftCurtain(),
    onSuccess: async () => {
      if (playerId !== undefined) forgetStep(playerId);
      setWarning(false);
      // the profile must come from the real server now: the story's fake one has no saved outcome
      setApiInterceptor(null);
      await reloadProfile();
    },
  });

  const finishRef = useRef(finish);
  finishRef.current = finish;

  const speak = useCallback(
    (moment: Moment) =>
      update((current) => ({
        ...current,
        queue: [...current.queue, ...scenesFor(guides, moment)],
      })),
    [guides, update],
  );

  // a step starts: put the pilot where it happens and narrow the nav
  useEffect(() => {
    setAllowedPaths(def.nav);
    // the friend hands over the scrap the hull upgrade takes
    if (def.id === 'upgrade') sandbox?.giveScrap(UPGRADE_SCRAP);
    const last = sandbox?.state.history.at(-1);
    if (def.path !== null) {
      void navigate(def.path, { replace: true });
    } else if (
      def.moment === undefined &&
      last !== undefined &&
      !pathRef.current.startsWith('/report/')
    ) {
      // a report step: the pilot reads the report of the flight they just made (or of the last one, coming back)
      // `fresh`: the result card opens for a flight that has just ended (once per mission)
      holdForResultCard(true);
      window.setTimeout(releaseUnlessCardShown, 8000);
      void navigate(`/report/${last.id}`, { replace: true, state: { fresh: true } });
    }
    // only a new step starts a step; the guides and the nav setter do not change inside one
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  useEffect(() => () => setAllowedPaths(null), [setAllowedPaths]);
  // every screen the story walks to fades in (see director.css), so a jump between screens is not a hard cut
  useEffect(() => {
    document.body.setAttribute('data-opening', '');
    return () => document.body.removeAttribute('data-opening');
  }, []);

  const advance = useCallback(() => {
    if (playerId === undefined) return;
    const next = nextStep(step);
    if (next === null) {
      // the faction page fades in from black, like the card the pilot has just read
      raiseCurtain();
      finishRef.current.mutate('played');
    } else writeStep(playerId, next);
  }, [playerId, step]);

  const beginLeave = useCallback(() => {
    // taking the gift: the engine lands in the pilot's hold now, not before
    if (step === 'gift') {
      sandbox?.giveEngine();
      void queryClientRef.current.invalidateQueries();
    }
    // done in a shop: the pilot is not kept there, the story walks them out and the menu opens on the ship
    const leaveTo = defRef.current.leaveTo;
    if (leaveTo !== undefined) {
      setAllowedPaths([leaveTo]);
      void navigateRef.current(leaveTo, { replace: true });
    }
    update((current) => ({
      ...current,
      phase: 'leave',
      queue: [...current.queue, ...scenesFor(guides, doneOf(step))],
    }));
  }, [guides, step, update, sandbox, setAllowedPaths]);

  // the lines are spoken: the pilot's turn, or the next step
  useEffect(() => {
    if (stored.step !== step || queue.length > 0 || !momentReady) return;
    if (phase === 'enter') update((current) => ({ ...current, phase: 'act' }));
    // the rescue cutter flies off first, then the story goes on
    else if (phase === 'leave' && (def.moment !== 'rescue' || departed)) advance();
  }, [stored.step, step, queue, phase, momentReady, advance, update, def.moment, departed]);

  // the pilot did the step's thing (and has nothing left to read): move on
  useEffect(() => {
    if (
      stored.step === step &&
      phase === 'act' &&
      satisfied &&
      !def.confirm &&
      momentReady &&
      queue.length === 0
    ) {
      beginLeave();
    }
  }, [stored.step, step, phase, satisfied, def, queue, momentReady, beginLeave]);

  // The race waits for the pilot: at the end of a leg the world's clock stops while the friend speaks, and goes on when
  // the last line is read (so a slow reader never has lines piling up, nor a race running behind a popup).
  const raceLegs = useRef<{
    ends: number[];
    next: number;
    strike: number;
    /** The final run's radar line: halfway through the leg the pirates strike on (null once it has been said). */
    radarAt: number | null;
  } | null>(null);
  const holding = useRef(false);
  /** What the held clock waits for: only the strike ends the flight when its line is read, the radar line does not. */
  const holdingFor = useRef<'leg' | 'radar' | 'strike'>('leg');
  useEffect(() => {
    if (holding.current && queue.length === 0) {
      holding.current = false;
      resumeClock();
      // the pirates have struck: once the friend's last line is read the flight is over, whatever legs were left
      if (stepRef.current === 'final-run' && holdingFor.current === 'strike') sandbox?.settle(true);
    }
  }, [queue.length, sandbox]);
  useEffect(
    () => () => {
      holding.current = false;
      resetClockHold();
    },
    [],
  );

  // what happens in the sandbox
  useEffect(() => {
    if (sandbox === null) return undefined;
    const off = sandbox.subscribe((event) => {
      const current = defRef.current;
      if (event.type === 'chosen') {
        if (playerId !== undefined) writeKind(playerId, event.kind);
        // the market sells the module of the chosen job only: what it showed before is out of date
        void queryClientRef.current.invalidateQueries();
      }
      if (event.type === 'dispatched' && (current.id === 'race' || current.id === 'final-run')) {
        const flight = sandbox.state.mission;
        let end = flight?.startedAt ?? serverNow();
        const ends = (flight?.legSeconds ?? []).map((seconds) => (end += seconds * MS));
        raceLegs.current = {
          ends,
          next: 0,
          // the pirates strike on the second leg, but always BEFORE the route is complete: a two-leg route is hit after its first
          strike: Math.max(1, Math.min(2, ends.length - 1)),
          radarAt: null,
        };
        const run = raceLegs.current;
        if (current.id === 'final-run') {
          // halfway through the leg the pirates strike on
          const from =
            run.strike >= 2 ? (ends[run.strike - 2] ?? 0) : (flight?.startedAt ?? serverNow());
          const to = ends[run.strike - 1];
          if (to !== undefined) run.radarAt = (from + to) / 2;
        }
      }
      // a flight is over: the pilot reads its report (the game's own jump to it is off in the opening)
      if (event.type === 'arrived') {
        raceLegs.current = null;
        // the screens must know the ship is back in port before the pilot walks to the next one
        void queryClientRef.current.invalidateQueries();
        // the final run is not read as a report: the ship is lost, and the story goes straight to the loss
        const lastResult = sandbox.state.history.at(-1);
        if (lastResult?.job.kind !== 'final') {
          // the guide waits for the result card (and never longer than a few seconds, in case the report does not open)
          holdForResultCard(true);
          window.setTimeout(releaseUnlessCardShown, 8000);
          void navigateRef.current(`/report/${event.missionId}`, {
            replace: true,
            state: { fresh: true },
          });
        }
      }
      if (completes(current, event, sandbox)) update((state) => ({ ...state, satisfied: true }));
    });
    // the story's own heartbeat: the end of a race leg, and a flight coming home (the sandbox has no timers of its own)
    const timer = window.setInterval(() => {
      const race = raceLegs.current;
      if (race !== null && !holding.current) {
        // the final run: the friend sees something on the radar, halfway through the leg the pirates strike on
        const radar = race.radarAt;
        const end = race.ends[race.next];
        if (
          radar !== null &&
          serverNow() >= radar &&
          (end === undefined || radar < end) &&
          stepRef.current === 'final-run'
        ) {
          race.radarAt = null;
          if (scenesFor(guides, radarOf()).length > 0) {
            holdClock(radar);
            holding.current = true;
            holdingFor.current = 'radar';
            speak(radarOf());
          }
          return;
        }
        if (end !== undefined && serverNow() >= end) {
          race.next += 1;
          const leg = race.next;
          // the race talks at the end of each leg; the final run only when the pirates strike
          const moment =
            stepRef.current === 'final-run'
              ? leg === race.strike
                ? finalLegOf(2)
                : null
              : legOf(leg);
          if (moment !== null && scenesFor(guides, moment).length > 0) {
            // the last leg ends in the arrival and the report: only the earlier ones stop the clock
            if (leg < race.ends.length) {
              holdClock(end);
              holding.current = true;
              holdingFor.current =
                stepRef.current === 'final-run' && leg === race.strike ? 'strike' : 'leg';
            }
            if (stepRef.current === 'final-run' && leg === race.strike) setStruck(true);
            speak(moment);
          }
        }
      }
      sandbox.settle();
    }, TICK_MS);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [sandbox, playerId, guides, speak, update]);

  // the screens this step leaves alive
  const allow = useMemo(
    () => (phase === 'act' && !satisfied ? def.allow : NO_ZONES),
    [phase, satisfied, def],
  );
  useOpeningLocks(allow, true);

  const readyMoment = useCallback(
    () => update((current) => ({ ...current, momentReady: true })),
    [update],
  );
  // a step's picture (the black screen of the loss) plays before anyone speaks
  const spoken = momentReady && !resultCardHeld ? queue[0] : undefined;
  // Bob's last lines are said: until the next voice opens, a ping goes out in the dark and fades into it
  const pinging =
    def.id === 'loss' &&
    spoken !== undefined &&
    spoken.key !== scenesFor(guides, enterOf('loss'))[0]?.key;
  const ready = phase === 'act' && queue.length === 0;
  const dropFirst = useCallback(
    () => update((current) => ({ ...current, queue: current.queue.slice(1) })),
    [update],
  );

  return (
    <>
      {/* black from the loss to the faction page: each picture is laid over it, so no gap shows the game screen */}
      {(struck || DARK_STEPS.includes(def.id)) && (
        <DarkMoment
          onReady={def.id === 'loss' ? readyMoment : noop}
          beatMs={struck ? 0 : undefined}
          ping={pinging}
        />
      )}
      {def.moment === 'rescue' && (
        <RescueMoment
          onReady={readyMoment}
          departing={phase === 'leave' && queue.length === 0}
          onDeparted={cutterGone}
        />
      )}
      {def.moment === 'later' && <LaterMoment onReady={readyMoment} />}
      {spoken !== undefined && <Speaker key={spoken.key} spoken={spoken} onDone={dropFirst} />}
      {/* a confirmation (take the engine, read on) is a card in the middle of the screen, like the guides' lines */}
      {ready && satisfied && def.confirm && (
        <div className="opening-confirm" data-opening-free="" data-step={step}>
          <button
            type="button"
            className="btn primary opening-continue"
            data-testid="opening-continue"
            onClick={beginLeave}
          >
            {t(`prologue.continueLabel.${step}`, { defaultValue: t('prologue.director.continue') })}
          </button>
        </div>
      )}
      <div className="opening-bar" data-opening-free="" data-testid="opening-bar" data-step={step}>
        <button
          type="button"
          className="btn tiny prologue-skip-link"
          data-testid="opening-skip"
          onClick={() => setWarning(true)}
          disabled={finish.isPending}
        >
          {t('prologue.skip.link')}
        </button>
        {/* TEMP-DEBUG-RESET: remove this button (and the import of writeStep's use here) when the final run is done */}
        <button
          type="button"
          className="btn tiny"
          data-testid="debug-reset-final"
          onClick={() => {
            if (playerId !== undefined) writeStep(playerId, 'final-run');
            window.location.reload();
          }}
        >
          [temp] restart final run
        </button>
      </div>
      {finish.isError && (
        <p className="error-text opening-error" role="alert" data-opening-free="">
          {t('onboarding.error.generic')}
        </p>
      )}
      <SkipWarning
        open={warning}
        busy={finish.isPending}
        onPlay={() => setWarning(false)}
        onSkip={() => finish.mutate('skipped')}
      />
    </>
  );
}
