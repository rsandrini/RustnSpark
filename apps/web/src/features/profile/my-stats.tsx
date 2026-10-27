import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MyStatsResponse } from '../../api/generated';

export interface MyStatsProps {
  stats: MyStatsResponse;
}

type StatsTab = 'flying' | 'combat' | 'money' | 'records';

const TAB_ORDER: StatsTab[] = ['flying', 'combat', 'money', 'records'];

const CREDIT_SUFFIX = '¢';

const EARNED_KEYS = [
  'money.earned_missions',
  'money.earned_parts',
  'money.earned_materials',
  'money.earned_other',
] as const;

const SPENT_KEYS = [
  'money.spent_parts',
  'money.spent_refuel',
  'money.spent_repair',
  'money.spent_upgrade',
  'money.spent_resize',
  'money.spent_rescue',
  'money.spent_other',
] as const;

function useNumberFormat(language: string) {
  return new Intl.NumberFormat(language);
}

function raceTimeText(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${remainder}`;
}

export function MyStats({ stats }: MyStatsProps) {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<StatsTab>('flying');
  const numberFormat = useNumberFormat(i18n.language);

  const totalOf = (key: string): number => stats.totals[key] ?? 0;

  const earned = EARNED_KEYS.reduce((sum, key) => sum + totalOf(key), 0);
  const spent = SPENT_KEYS.reduce((sum, key) => sum + totalOf(key), 0);
  const net = earned - spent;

  const dateText = (raw: string): string =>
    new Date(raw).toLocaleDateString(i18n.language, { dateStyle: 'medium' });

  const renderRow = (labelKey: string, value: string | number) => (
    <div className="my-stat-row" key={labelKey}>
      <dt>{t(labelKey)}</dt>
      <dd>{value}</dd>
    </div>
  );

  const renderNumberRow = (labelKey: string, key: string) =>
    renderRow(labelKey, numberFormat.format(totalOf(key)));

  const renderRecordRow = (labelKey: string, recordKey: string) => {
    const record = stats.records[recordKey];
    if (record === undefined) return null;
    let value = numberFormat.format(record.value);
    if (recordKey === 'best.race_seconds') {
      value = raceTimeText(record.value);
    }
    return (
      <div className="my-stat-row" key={labelKey}>
        <dt>{t(labelKey)}</dt>
        <dd>
          <span className="my-stat-value">{value}</span>
          <span className="my-stat-date">{dateText(record.at)}</span>
        </dd>
      </div>
    );
  };

  return (
    <section className="my-stats" aria-label={t('profile.stats.title')}>
      <div className="my-stats-tabs" role="tablist">
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={activeTab === tab ? 'active' : undefined}
            onClick={() => setActiveTab(tab)}
          >
            {t(`profile.stats.tabs.${tab}`)}
          </button>
        ))}
      </div>

      <div className="my-stats-panel" role="tabpanel">
        {activeTab === 'flying' && (
          <dl className="my-stats-list">
            {renderNumberRow('profile.stats.groups.missions.started', 'missions.started')}
            {renderNumberRow('profile.stats.groups.missions.success', 'missions.success')}
            {renderNumberRow('profile.stats.groups.missions.failed', 'missions.failed')}
            {renderNumberRow('profile.stats.groups.missions.aborted', 'missions.aborted')}
            {renderNumberRow('profile.stats.groups.flight.distance', 'flight.distance')}
            {renderNumberRow('profile.stats.groups.flight.legs', 'flight.legs')}
            {renderNumberRow('profile.stats.groups.fuel.burned', 'fuel.burned')}
            {renderNumberRow('profile.stats.groups.fuel.lost', 'fuel.lost')}
            {renderNumberRow('profile.stats.groups.rescue.called', 'rescue.called')}
            {renderNumberRow('profile.stats.groups.adrift.times', 'adrift.times')}
          </dl>
        )}

        {activeTab === 'combat' && (
          <dl className="my-stats-list">
            {renderNumberRow('profile.stats.groups.fights.won', 'fights.won')}
            {renderNumberRow('profile.stats.groups.fights.lost', 'fights.lost')}
            {renderNumberRow('profile.stats.groups.fights.escaped', 'fights.escaped')}
            {renderNumberRow('profile.stats.groups.fights.drawn', 'fights.drawn')}
            {renderNumberRow('profile.stats.groups.fights.pirate', 'fights.pirate')}
            {renderNumberRow('profile.stats.groups.fights.pvp', 'fights.pvp')}
            {renderNumberRow('profile.stats.groups.damage.taken', 'damage.taken')}
            {renderNumberRow('profile.stats.groups.damage.takenShield', 'damage.taken_shield')}
            {renderNumberRow('profile.stats.groups.damage.takenArmor', 'damage.taken_armor')}
            {renderNumberRow('profile.stats.groups.damage.takenHull', 'damage.taken_hull')}
            {renderNumberRow('profile.stats.groups.damage.dealt', 'damage.dealt')}
            {renderNumberRow('profile.stats.groups.pirates.partsStolen', 'pirates.parts_stolen')}
          </dl>
        )}

        {activeTab === 'money' && (
          <dl className="my-stats-list">
            <div className="my-stat-row">
              <dt>{t('profile.stats.money.earned')}</dt>
              <dd>{numberFormat.format(earned)} {CREDIT_SUFFIX}</dd>
            </div>
            <div className="my-stat-row">
              <dt>{t('profile.stats.money.spent')}</dt>
              <dd>{numberFormat.format(spent)} {CREDIT_SUFFIX}</dd>
            </div>
            <div className="my-stat-row my-stat-highlight">
              <dt>{t('profile.stats.money.net')}</dt>
              <dd className={net >= 0 ? 'positive' : 'negative'}>
                {numberFormat.format(net)} {CREDIT_SUFFIX}
              </dd>
            </div>
          </dl>
        )}

        {activeTab === 'records' && (
          <dl className="my-stats-list">
            {renderRecordRow('profile.stats.records.best.payout', 'best.payout')}
            {renderRecordRow('profile.stats.records.best.runDistance', 'best.run_distance')}
            {renderRecordRow('profile.stats.records.best.wallet', 'best.wallet')}
            {renderRecordRow('profile.stats.records.best.racePlace', 'best.race_place')}
            {renderRecordRow('profile.stats.records.best.raceSeconds', 'best.race_seconds')}
            {renderRecordRow('profile.stats.records.worst.runDamage', 'worst.run_damage')}
          </dl>
        )}
      </div>
    </section>
  );
}
