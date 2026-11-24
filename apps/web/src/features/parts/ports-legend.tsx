import { useTranslation } from 'react-i18next';
import { kindCompatible, type Kind, type PortState } from '../hangar/connectors';
import { KindIcon } from './connector-grid';

type PortKind = Exclude<Kind, 'none'>;

const KINDS: readonly { kind: PortKind; dots: number }[] = [
  { kind: 'central', dots: 1 },
  { kind: 'split', dots: 2 },
  { kind: 'universal', dots: 3 },
];
const COLON = ': ';
const PLUS = '+';
const STATES: readonly PortState[] = ['connected', 'available', 'incorrect'];

// Unordered pairs in KINDS order; the verdict comes from kindCompatible so the table cannot
// drift from the rules.
const PAIRS = KINDS.flatMap((a, i) => KINDS.slice(i).map((b) => [a.kind, b.kind] as const));

/** Collapsed "Ports?" help: the three kinds, the three states and what joins what. */
export function PortsLegend() {
  const { t } = useTranslation();
  return (
    <details className="ports-legend" data-testid="ports-legend">
      <summary className="ports-legend-summary">{t('portsLegend.summary')}</summary>
      <div className="ports-legend-body">
        <ul className="ports-legend-list">
          {KINDS.map(({ kind, dots }) => (
            <li key={kind} data-testid={`legend-kind-${kind}`}>
              <KindIcon kind={kind} />
              <span>{t(`portsLegend.kinds.${kind}`)}</span>
              <span className="ports-legend-count">{t('portsLegend.dots', { count: dots })}</span>
            </li>
          ))}
        </ul>
        <ul className="ports-legend-list">
          {STATES.map((state) => (
            <li
              key={state}
              className={`conn-swatch conn-${state}`}
              data-testid={`legend-state-${state}`}
            >
              {t(`portsLegend.states.${state}`)}
            </li>
          ))}
        </ul>
        <p className="ports-legend-heading">{t('portsLegend.joinsTitle')}</p>
        <ul className="ports-legend-list">
          {PAIRS.map(([a, b]) => {
            const joins = kindCompatible(a, b);
            return (
              <li
                key={`${a}-${b}`}
                data-testid={`legend-join-${a}-${b}`}
                data-joins={String(joins)}
              >
                <span className="sr-only">
                  {[t(`portsLegend.kinds.${a}`), PLUS, t(`portsLegend.kinds.${b}`)].join(' ')}
                  {COLON}
                </span>
                <KindIcon kind={a} />
                <span aria-hidden="true">{PLUS}</span>
                <KindIcon kind={b} />
                <span className={joins ? 'ports-legend-yes' : 'ports-legend-no'}>
                  {t(joins ? 'portsLegend.joins' : 'portsLegend.doesNotJoin')}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
