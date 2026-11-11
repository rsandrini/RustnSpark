import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { client, setApiInterceptor } from '../../../api/client';
import { DialogueBox } from '../../dialogue/dialogue-box';
import { useAuth } from '../../auth/auth.hooks';
import { usePrologueMode } from '../prologue-mode';
import { forgetStep, usePrologueStep, writeKind, writeStep } from '../prologue-state';
import { SkipWarning } from '../skip-warning';
import { moduleKindOf } from '../sandbox/sandbox-offers';
import { previewOf } from '../sandbox/sandbox-ship';
import { UPGRADE_SCRAP } from '../sandbox/sandbox-world';
import type { Sandbox, SandboxEvent } from '../sandbox/sandbox-state';
import { doneOf, enterOf, legOf, scenesFor, startNode, type Moment, type Spoken } from './lines';
import { useOpeningLocks } from './locks';
import { LossMoment, RescueMoment } from './moments';
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
const MS = 1000;

/** Did the pilot's save leave a ship the step is happy with (the engine fitted, the module fitted, nothing broken)? */
function fitted(sandbox: Sandbox, step: StepId): boolean {
  const preview = previewOf(sandbox, sandbox.state.layout);
  if (!preview.viability.viable) return false;
  // a ship that can fly has its engine; the second fitting is done when the module is on it too
  return step === 'fit-engine' || moduleKindOf(sandbox) !== null;
}

/** Does `event` finish the pilot's part of `def`? */
function completes(def: StepDef, event: SandboxEvent, sandbox: Sandbox): boolean {
  if (def.until === null || event.type !== def.until) return false;
  if (def.until === 'layout_saved') return fitted(sandbox, def.id);
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
  const { sandbox, guides, friendName, setAllowedPaths } = opening;
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
    onSuccess: async () => {
      if (playerId !== undefined) forgetStep(playerId);
      setWarning(false);
      // the profile must come from the real server now: the story's fake one has no saved outcome
      setApiInterceptor(null);
      await reloadProfile();
    },
  });

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
    } else if (last !== undefined && !pathRef.current.startsWith('/report/')) {
      // a report step: the pilot reads the report of the flight they just made (or of the last one, coming back)
      void navigate(`/report/${last.id}`, { replace: true });
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
    if (next === null) finish.mutate('played');
    else writeStep(playerId, next);
  }, [playerId, step, finish]);

  const beginLeave = useCallback(() => {
    update((current) => ({
      ...current,
      phase: 'leave',
      queue: [...current.queue, ...scenesFor(guides, doneOf(step))],
    }));
  }, [guides, step, update]);

  // the lines are spoken: the pilot's turn, or the next step
  useEffect(() => {
    if (stored.step !== step || queue.length > 0 || !momentReady) return;
    if (phase === 'enter') update((current) => ({ ...current, phase: 'act' }));
    else if (phase === 'leave') advance();
  }, [stored.step, step, queue, phase, momentReady, advance, update]);

  // the pilot did the step's thing (and has nothing left to read): move on
  useEffect(() => {
    if (
      stored.step === step &&
      phase === 'act' &&
      satisfied &&
      !def.confirm &&
      def.moment === undefined &&
      queue.length === 0
    ) {
      beginLeave();
    }
  }, [stored.step, step, phase, satisfied, def, queue, beginLeave]);

  // what happens in the sandbox
  const legTimers = useRef<number[]>([]);
  useEffect(() => {
    if (sandbox === null) return undefined;
    const clearLegs = () => {
      legTimers.current.forEach((timer) => window.clearTimeout(timer));
      legTimers.current = [];
    };
    const off = sandbox.subscribe((event) => {
      const current = defRef.current;
      if (event.type === 'chosen') {
        if (playerId !== undefined) writeKind(playerId, event.kind);
        // the market sells the module of the chosen job only: what it showed before is out of date
        void queryClientRef.current.invalidateQueries();
      }
      if (event.type === 'dispatched' && current.id === 'race') {
        // a radio line at the end of each leg of the race
        const legs = sandbox.state.mission?.legSeconds ?? [];
        let elapsed = 0;
        clearLegs();
        legs.forEach((seconds, index) => {
          elapsed += seconds;
          legTimers.current.push(window.setTimeout(() => speak(legOf(index + 1)), elapsed * MS));
        });
      }
      // a flight is over: the pilot reads its report (the game's own jump to it is off in the opening)
      if (event.type === 'arrived') {
        // the screens must know the ship is back in port before the pilot walks to the next one
        void queryClientRef.current.invalidateQueries();
        void navigateRef.current(`/report/${event.missionId}`, { replace: true });
      }
      if (completes(current, event, sandbox)) update((state) => ({ ...state, satisfied: true }));
    });
    return () => {
      off();
      clearLegs();
    };
  }, [sandbox, playerId, speak, update]);

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
  const spoken = queue[0];
  const ready = phase === 'act' && queue.length === 0;
  const dropFirst = useCallback(
    () => update((current) => ({ ...current, queue: current.queue.slice(1) })),
    [update],
  );

  return (
    <>
      {def.moment === 'loss' && (
        <LossMoment
          onReady={readyMoment}
          friend={friendName}
          settled={ready}
          onContinue={beginLeave}
        />
      )}
      {def.moment === 'rescue' && <RescueMoment onReady={readyMoment} friend={friendName} />}
      {spoken !== undefined && <Speaker key={spoken.key} spoken={spoken} onDone={dropFirst} />}
      {/* what to do now sits at the bottom, in the middle; a confirmation (take the engine, read on) is a card in the middle of the screen, like the guides' lines */}
      {ready && !satisfied && def.moment === undefined && (
        <p className="opening-hint" data-opening-free="" data-testid="opening-hint">
          {t(`prologue.hint.${step}`)}
        </p>
      )}
      {ready && satisfied && def.confirm && (
        <div className="opening-confirm" data-opening-free="">
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
