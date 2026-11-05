import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';

/** What a pilot sees after an action: the button answers, the numbers move, and one short message says what next. */
export interface FeedbackNext {
  label: string;
  to: string;
}
export interface FeedbackOptions {
  /** A short next step, shown as a link on the message. */
  next?: FeedbackNext;
  /** A ship crosses the line under the top bar (a dispatch). */
  takeoff?: boolean;
}
interface FeedbackApi {
  /** False without a provider (a screen rendered alone): callers then keep their own inline message. */
  available: boolean;
  notify: (message: string, options?: FeedbackOptions) => void;
}

const NOOP: FeedbackApi = { available: false, notify: () => undefined };
const FeedbackContext = createContext<FeedbackApi>(NOOP);

/** How long a message stays on screen. */
export const FEEDBACK_MS = 3200;
/** How long the button keeps its "done" look. */
export const ANSWER_MS = 1200;
/** How long the ship takes to cross the line. */
export const TAKEOFF_MS = 1000;
/** A very short buzz where the browser allows it (Android; iPhones do not support it). */
const VIBRATE_MS = 25;
const TICK = '\u2713';
const CROSS = '\u00d7';

interface Toast {
  id: number;
  message: string;
  next: FeedbackNext | undefined;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const [takeoff, setTakeoff] = useState(0);
  const counter = useRef(0);
  const timer = useRef<number | null>(null);

  const notify = useCallback((message: string, options: FeedbackOptions = {}) => {
    counter.current += 1;
    setToast({ id: counter.current, message, next: options.next });
    if (options.takeoff === true) setTakeoff(counter.current);
    try {
      navigator.vibrate?.(VIBRATE_MS);
    } catch {
      // not available here
    }
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), FEEDBACK_MS);
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const api = useMemo<FeedbackApi>(() => ({ available: true, notify }), [notify]);
  return (
    <FeedbackContext.Provider value={api}>
      {children}
      <FeedbackHost toast={toast} takeoff={takeoff} onClose={() => setToast(null)} />
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackApi {
  return useContext(FeedbackContext);
}

/**
 * The state of a message that used to sit inline on a screen. With the feedback host it is a message under the
 * top bar (and `notice` stays null); without it (a screen rendered alone) it stays inline, as before.
 */
export function useNotice(): {
  notice: string | null;
  setNotice: (text: string | null, options?: FeedbackOptions) => void;
} {
  const feedback = useFeedback();
  const [inline, setInline] = useState<string | null>(null);
  const { notify, available } = feedback;
  const setNotice = useCallback(
    (text: string | null, options?: FeedbackOptions) => {
      if (available) {
        if (text !== null) notify(text, options);
        return;
      }
      setInline(text);
    },
    [available, notify],
  );
  return { notice: available ? null : inline, setNotice };
}

function FeedbackHost({
  toast,
  takeoff,
  onClose,
}: {
  toast: Toast | null;
  takeoff: number;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <>
      <div className="feedback-strip" aria-hidden="true">
        {takeoff > 0 && (
          <svg key={takeoff} className="feedback-ship" viewBox="0 0 28 20">
            <path d="M27 10 L5 1 L10 10 L5 19 Z" />
          </svg>
        )}
      </div>
      <div
        className={`feedback-toast${toast !== null ? ' show' : ''}`}
        data-testid="feedback-toast"
      >
        {toast !== null && (
          <div className="feedback-body" key={toast.id}>
            <span className="feedback-tick" aria-hidden="true">
              {TICK}
            </span>
            <span className="feedback-msg" role="status">
              {toast.message}
            </span>
            {toast.next !== undefined && (
              <button
                type="button"
                className="feedback-next"
                onClick={() => {
                  onClose();
                  void navigate(toast.next?.to ?? '/');
                }}
              >
                {toast.next.label}
              </button>
            )}
            <button
              type="button"
              className="feedback-close"
              aria-label={t('ui.close')}
              onClick={onClose}
            >
              {CROSS}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * The look of a button while it works and right after it worked: 'busy' (a spinner) while the request runs,
 * 'done' (green, with the new word) for a moment after it succeeded.
 */
export function useAnswer(pending: boolean, succeeded: boolean): 'idle' | 'busy' | 'done' {
  const [done, setDone] = useState(false);
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !pending && succeeded) {
      setDone(true);
      const timer = window.setTimeout(() => setDone(false), ANSWER_MS);
      was.current = pending;
      return () => window.clearTimeout(timer);
    }
    was.current = pending;
    return undefined;
  }, [pending, succeeded]);
  if (pending) return 'busy';
  return done ? 'done' : 'idle';
}
