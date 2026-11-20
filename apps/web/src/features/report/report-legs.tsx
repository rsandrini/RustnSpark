import { useTranslation } from 'react-i18next';
import type { ReportStats } from '../../api/generated';

const FULL = 100;

/**
 * The run leg by leg: where the fuel went and what each leg cost. The bar is the tank at the start of the run; on each
 * leg it shows what the leg burned as planned (distance and terrain), what a failing tank pump wasted on top, and what a
 * leak lost. A leg that ran dry says what it needed against what the tank held. Read from the stored run.
 */
export function ReportLegs({ stats }: { stats: ReportStats }) {
  const { t, i18n } = useTranslation();
  const number = (value: number) => new Intl.NumberFormat(i18n.language).format(Math.round(value));
  const fuel = (value: number) => t('report.legs.unit', { value: number(value) });
  const legs = stats.byLeg ?? [];
  const start = stats.startFuel ?? null;
  if (legs.length === 0) {
    return <p className="sub">{t('report.legs.none')}</p>;
  }
  const scale =
    start !== null && start > 0 ? start : Math.max(...legs.map((row) => row.fuelBefore ?? 0), 1);
  const share = (value: number) => `${Math.min(FULL, Math.max(0, (value / scale) * FULL))}%`;
  return (
    <section className="report-legs" data-testid="report-legs">
      {start !== null && (
        <p className="legs-start">
          <b>{t('report.legs.start')}</b> {t('report.legs.inTank', { fuel: fuel(start) })}
        </p>
      )}
      <table className="legs-table">
        <thead>
          <tr>
            <th>{t('report.legs.leg')}</th>
            <th>{t('report.legs.fuel')}</th>
            <th>{t('report.legs.damage')}</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((row) => {
            const dry = row.status === 'adrift';
            const base = row.fuelBase ?? 0;
            const pump = row.fuelPump ?? 0;
            const leak = row.fuelLeak ?? 0;
            const damage = row.damage.shield + row.damage.armor + row.damage.hull;
            return (
              <tr key={row.leg} className={dry ? 'legs-dry' : undefined}>
                <td>{t('report.legs.legN', { leg: row.leg })}</td>
                <td>
                  <div className="legs-track" aria-hidden="true">
                    <span className="legs-seg base" style={{ width: share(base) }} />
                    <span className="legs-seg pump" style={{ width: share(pump) }} />
                    <span className="legs-seg leak" style={{ width: share(leak) }} />
                  </div>
                  {dry ? (
                    <div className="legs-line">
                      <span>
                        {t('report.legs.needed', {
                          needed: fuel(row.fuelNeeded ?? base + pump),
                          had: fuel(row.fuelBefore ?? 0),
                        })}
                      </span>
                      <b className="legs-ran-dry">{t('report.legs.ranDry')}</b>
                    </div>
                  ) : (
                    <>
                      {row.fuelBase != null && (
                        <div className="legs-used">
                          {t('report.legs.used', { fuel: fuel(base + pump + leak) })}
                        </div>
                      )}
                      {row.fuelBefore != null && (
                        <div className="sub">
                          {t('report.legs.tankMove', {
                            before: fuel(row.fuelBefore),
                            after: fuel(row.fuelAfter ?? 0),
                          })}
                        </div>
                      )}
                    </>
                  )}
                  <div className="legs-parts">
                    <span>{t('report.legs.madeOf')}</span>
                    {row.fuelBase != null && (
                      <span className="legs-part base">
                        {t('report.legs.planned', { fuel: fuel(row.fuelBase) })}
                      </span>
                    )}
                    {pump > 0 && (
                      <span className="legs-part pump">
                        {t('report.legs.pump', { fuel: fuel(pump) })}
                      </span>
                    )}
                    {leak > 0 && (
                      <span className="legs-part leak">
                        {t('report.legs.leak', { fuel: fuel(leak) })}
                      </span>
                    )}
                  </div>
                  {dry && row.pumpChancePct != null && pump > 0 && (
                    <div className="sub">
                      {t('report.outcome.adriftWhy.pumpChance', { chance: row.pumpChancePct })}
                    </div>
                  )}
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
      <p className="sub">
        {t('report.legs.key')} {t('report.legs.note')}
      </p>
    </section>
  );
}
