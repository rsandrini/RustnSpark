import { useTranslation } from 'react-i18next';
import type { ReportStats } from '../../api/generated';

const FULL = 100;

/**
 * The run leg by leg: the fuel left in the tank when each leg ended (a bar against what the run started with, with the
 * fuel a failing pump wasted marked on it) and the damage each leg cost. Read from the stored run, never worked out here.
 */
export function ReportLegs({ stats }: { stats: ReportStats }) {
  const { t, i18n } = useTranslation();
  const number = (value: number) => new Intl.NumberFormat(i18n.language).format(Math.round(value));
  const legs = stats.byLeg ?? [];
  const start = stats.startFuel ?? null;
  if (legs.length === 0) {
    return <p className="sub">{t('report.legs.none')}</p>;
  }
  return (
    <section className="report-legs" data-testid="report-legs">
      <table className="legs-table">
        <thead>
          <tr>
            <th>{t('report.legs.leg')}</th>
            <th>{t('report.legs.fuel')}</th>
            <th>{t('report.legs.damage')}</th>
          </tr>
        </thead>
        <tbody>
          {start !== null && (
            <tr>
              <td>{t('report.legs.start')}</td>
              <td colSpan={2}>
                <div className="legs-fuel">
                  <span className="legs-bar" aria-hidden="true">
                    <span className="legs-bar-fill ok" style={{ width: '100%' }} />
                  </span>
                  <span className="legs-fuel-text">
                    {t('report.legs.inTank', { fuel: number(start) })}
                  </span>
                </div>
              </td>
            </tr>
          )}
          {legs.map((row) => {
            const dry = row.status === 'adrift';
            const share =
              start === null || start <= 0 || row.fuelAfter === null
                ? 0
                : Math.min(FULL, Math.max(0, (row.fuelAfter / start) * FULL));
            const tone = dry ? 'bad' : share < 25 ? 'bad' : share < 50 ? 'warn' : 'ok';
            const damage = row.damage.shield + row.damage.armor + row.damage.hull;
            return (
              <tr key={row.leg} className={dry ? 'legs-dry' : undefined}>
                <td>{t('report.legs.legN', { leg: row.leg })}</td>
                <td>
                  <div className="legs-fuel">
                    <span className="legs-bar" aria-hidden="true">
                      <span className={`legs-bar-fill ${tone}`} style={{ width: `${share}%` }} />
                    </span>
                    <span className="legs-fuel-text">
                      {dry
                        ? t('report.legs.ranDry')
                        : row.fuelAfter === null
                          ? ''
                          : t('report.legs.left', { fuel: number(row.fuelAfter) })}
                      {row.fuelWasted > 0 && (
                        <small className="legs-waste">
                          {t('report.legs.wasted', { fuel: number(row.fuelWasted) })}
                        </small>
                      )}
                    </span>
                  </div>
                </td>
                <td>
                  {damage === 0
                    ? t('report.legs.noDamage')
                    : t('report.legs.damageValue', {
                        shield: row.damage.shield,
                        armor: row.damage.armor,
                        hull: row.damage.hull,
                      })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="sub">{t('report.legs.note')}</p>
    </section>
  );
}
