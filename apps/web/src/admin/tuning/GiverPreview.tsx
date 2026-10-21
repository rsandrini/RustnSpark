import { useTranslation } from 'react-i18next';
import { pickLocalized } from '../../i18n/localized';
import { GiverBadge } from '../../ui/GiverBadge';

// The giver's badge as the pilot will see it, live above the admin form (plan §7): name, title
// and faction as typed, so an owner can check the face before saving. The portrait comes from
// the ArtEditor below the preview (uploaded per row, no public listing to read it back from).
export function GiverPreview({ values }: { values: Record<string, unknown> }) {
  const { t, i18n } = useTranslation();
  const name = typeof values.name === 'string' ? values.name : '';
  if (name.trim() === '') return null;
  const title =
    typeof values.title === 'object' && values.title !== null
      ? (values.title as { en: string; 'pt-BR': string })
      : null;
  const factionId = typeof values.factionId === 'string' ? values.factionId : '';
  return (
    <div className="giver-preview" data-testid="giver-preview">
      <b>{t('admin.givers.previewLabel')}</b>
      <GiverBadge
        name={name}
        title={title === null ? '' : pickLocalized(title, i18n.language)}
        portraitUrl={null}
        factionId={factionId}
      />
    </div>
  );
}
