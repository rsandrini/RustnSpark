import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import type { EnginePreview, ShipResponse } from '../../api/generated';
import { scaleSpeed, useDisplay } from '../../ui/display';
import { formatDuration } from '../../ui/duration';

const SAVE_DELAY_MS = 500;
const SLIDER_STEP = 0.05;
const PERCENT = 100;
const GOOD_CLEAN = 0.9;
const OK_CLEAN = 0.6;

// Quick settings; the server keeps whatever it receives inside the admin's ranges.
const PRESETS = [
  { id: 'economy', chem: 0.75, ion: 1.5 },
  { id: 'normal', chem: 1, ion: 1 },
  { id: 'sprint', chem: 1.25, ion: 1.5 },
] as const;

type Group = 'chem' | 'ion';

function cleanTone(chance: number): 'ok' | 'warn' | 'bad' {
  return chance >= GOOD_CLEAN ? 'ok' : chance >= OK_CLEAN ? 'warn' : 'bad';
}

/**
 * The bridge's engine tuning: how hard the chemical engines and the ion engines run. Below 1 an
 * engine throttles down (slower, cheaper), above 1 it pushes (faster, dearer, and it can fail).
 * The numbers under the sliders are the server's own maths for these levels — speed, fuel, power
 * and the chance the whole run goes clean — so the pilot decides if the risk is worth it. With a
 * `missionId` it also shows that trip's time and fuel.
 */
export function EngineTuning({ ship, missionId }: { ship: ShipResponse; missionId?: string }) {
  const { t, i18n } = useTranslation();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const editable = ship.status === 'IN_PORT';
  // (older/partial ship payloads carry no levels: read as the engines as listed)
  const saved: { chem: number; ion: number } = (ship as Partial<ShipResponse>).engineLevels ?? {
    chem: 1,
    ion: 1,
  };
  const [levels, setLevels] = useState(saved);

  useEffect(() => {
    setLevels({ chem: saved.chem, ion: saved.ion });
  }, [saved.chem, saved.ion]);

  const preview = useQuery({
    queryKey: ['engine-preview', ship.id, missionId ?? null, levels.chem, levels.ion, ship.fuel],
    queryFn: () =>
      client.post<EnginePreview>(`/v1/ships/${ship.id}/engine-preview`, {
        chem: levels.chem,
        ion: levels.ion,
        ...(missionId !== undefined ? { missionId } : {}),
      }),
    placeholderData: keepPreviousData,
  });

  const save = useMutation({
    mutationFn: (next: { chem: number; ion: number }) =>
      client.post<ShipResponse>(`/v1/ships/${ship.id}/engine-levels`, next),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ships'] });
      void queryClient.invalidateQueries({ queryKey: ['active'] });
      void queryClient.invalidateQueries({ queryKey: ['missions'] });
    },
  });

  // Save a moment after the pilot stops moving a slider.
  useEffect(() => {
    if (!editable || (levels.chem === saved.chem && levels.ion === saved.ion)) return undefined;
    const timer = window.setTimeout(() => save.mutate(levels), SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levels.chem, levels.ion, editable]);

  const data = preview.data;
  const number = (value: number, digits = 1) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: digits }).format(value);
  const speed = (raw: number) => number(scaleSpeed(raw, display));
  const groups = data?.groups ?? [];
  const sliderFor = (group: Group) => {
    if (!groups.includes(group)) return null;
    const [low, high] = data?.ranges[group] ?? [saved[group], saved[group]];
    return (
      <label key={group} className="engine-slider">
        <span>
          <b>{t(`engineTuning.group.${group}`)}</b>{' '}
          <span className="engine-level">
            {t('engineTuning.level', { value: number(levels[group], 2) })}
          </span>
        </span>
        <input
          type="range"
          min={low}
          max={high}
          step={SLIDER_STEP}
          value={levels[group]}
          disabled={!editable}
          aria-label={t(`engineTuning.group.${group}`)}
          onChange={(event) => setLevels({ ...levels, [group]: Number(event.target.value) })}
        />
        <small className="sub">{t(`engineTuning.hint.${group}`)}</small>
      </label>
    );
  };

  return (
    <div
      className="engine-tuning"
      data-testid="engine-tuning"
      role="group"
      aria-label={t('engineTuning.title')}
    >
      <b className="engine-tuning-title">{t('engineTuning.title')}</b>
      <p className="sub">{t('engineTuning.intro')}</p>
      {!editable && <p className="notice warn">{t('engineTuning.locked')}</p>}
      <div className="chips" role="group" aria-label={t('engineTuning.presets')}>
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="chip"
            disabled={!editable}
            onClick={() => setLevels({ chem: preset.chem, ion: preset.ion })}
          >
            {t(`engineTuning.preset.${preset.id}`)}
          </button>
        ))}
      </div>
      {sliderFor('chem')}
      {sliderFor('ion')}
      {data !== undefined && (
        <ul className="engine-stats" data-testid="engine-stats">
          <li>
            {t('engineTuning.speed', {
              value: speed(data.mobility),
              base: speed(data.baseline.mobility),
            })}
          </li>
          {groups.includes('chem') && (
            <li>
              {t('engineTuning.fuelBurn', {
                value: number(data.fuelUse),
                base: number(data.baseline.fuelUse),
              })}
            </li>
          )}
          <li className={data.power.spare < 0 ? 'bad' : undefined}>
            {t('engineTuning.power', {
              supply: number(data.power.supply),
              demand: number(data.power.demand),
              spare: number(data.power.spare),
            })}
          </li>
          <li className={`clean ${cleanTone(data.cleanChance)}`} data-testid="engine-clean">
            {t('engineTuning.clean', { percent: Math.round(data.cleanChance * PERCENT) })}
          </li>
          {data.trip !== undefined && (
            <>
              <li data-testid="engine-trip-time">
                {t('engineTuning.tripTime', {
                  value: formatDuration(data.trip.durationSeconds, t),
                  base: formatDuration(data.trip.baseline.durationSeconds, t),
                })}
              </li>
              <li className={data.trip.fits ? undefined : 'bad'} data-testid="engine-trip-fuel">
                {t('engineTuning.tripFuel', {
                  needed: number(data.trip.fuelNeeded, 0),
                  have: number(data.trip.fuelHave, 0),
                  base: number(data.trip.baseline.fuelNeeded, 0),
                })}
              </li>
            </>
          )}
        </ul>
      )}
      {data?.trip !== undefined && !data.trip.fits && (
        <p className="error-text" role="alert">
          {t('engineTuning.tripNoFit')}
        </p>
      )}
    </div>
  );
}
