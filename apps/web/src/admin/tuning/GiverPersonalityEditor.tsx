import { useTranslation } from 'react-i18next';
import { MissionTypeSchema } from '@rustandspark/contract';

// Admin editor for a giver's personality (plan §3): which mission types they hand out and how
// often, the zone band they stay inside, and the tone tag that picks their lines. The shape is
// the server's own ({types, minZone, maxZone, tone} — entity-schemas.ts and giver.picker.ts), so
// what is written here is exactly what the picker reads. A weight of 0 means "never offers that
// type". rewardBias is out of v1 (plan open point 5).
export interface GiverPersonality {
  types: Record<string, number>;
  minZone: number;
  maxZone: number;
  tone: string;
}

export interface GiverPersonalityEditorProps {
  value: Partial<GiverPersonality> | null | undefined;
  onChange: (next: GiverPersonality) => void;
}

const TONES = ['formal', 'gruff', 'friendly', 'nervous'] as const;

export function GiverPersonalityEditor({ value, onChange }: GiverPersonalityEditorProps) {
  const { t } = useTranslation();
  const types = value?.types ?? {};
  const minZone = value?.minZone ?? 0;
  const maxZone = value?.maxZone ?? 1;
  const tone = value?.tone ?? 'friendly';

  const emit = (patch: Partial<GiverPersonality>): void =>
    onChange({ types, minZone, maxZone, tone, ...patch });

  return (
    <div className="giver-personality-editor" role="group">
      <p className="muted">{t('admin.givers.personalityHelp')}</p>
      <table className="relations-table">
        <thead>
          <tr>
            <th>{t('admin.givers.missionType')}</th>
            <th>{t('admin.givers.typeWeight')}</th>
          </tr>
        </thead>
        <tbody>
          {MissionTypeSchema.options.map((type) => (
            <tr key={type}>
              <td>{t(`board.type.${type}`)}</td>
              <td>
                <input
                  type="number"
                  min={0}
                  step={1}
                  aria-label={`${t('admin.givers.typeWeight')} ${t(`board.type.${type}`)}`}
                  data-testid={`giver-weight-${type}`}
                  value={types[type] ?? 0}
                  onChange={(event) =>
                    emit({ types: { ...types, [type]: Number(event.target.value) } })
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="kv-row">
        <label>
          {t('admin.givers.riskMin')}
          <input
            type="number"
            min={0}
            max={9}
            data-testid="giver-min-zone"
            value={minZone}
            onChange={(event) => emit({ minZone: Number(event.target.value) })}
          />
        </label>
        <label>
          {t('admin.givers.riskMax')}
          <input
            type="number"
            min={0}
            max={9}
            data-testid="giver-max-zone"
            value={maxZone}
            onChange={(event) => emit({ maxZone: Number(event.target.value) })}
          />
        </label>
      </div>
      <label>
        {t('admin.givers.tone')}
        <select
          data-testid="giver-tone"
          value={tone}
          onChange={(event) => emit({ tone: event.target.value })}
        >
          {/* A tone the selects do not know (owner-typed earlier) still shows instead of blank. */}
          {!(TONES as readonly string[]).includes(tone) && <option value={tone}>{tone}</option>}
          {TONES.map((option) => (
            <option key={option} value={option}>
              {t(`admin.givers.tones.${option}`)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
