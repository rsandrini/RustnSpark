import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorldLocation } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { RiskBadge } from '../../ui/RiskBadge';
import { HelpTip } from '../../ui/kit/HelpTip';

export interface PlacesDrawerProps {
  /** Every place, in the order to list them (nearest to the ship first). */
  places: readonly WorldLocation[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** The collapsed "Places" list: a search box and every place; picking one opens its sheet. */
export function PlacesDrawer({ places, onSelect, onClose }: PlacesDrawerProps) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const nameOf = (place: WorldLocation) => pickLocalized(place.displayName, i18n.language);
  const typeOf = (place: WorldLocation) =>
    t(`map.types.${place.type}`, { defaultValue: place.type });
  const needle = query.trim().toLowerCase();
  const shown =
    needle === ''
      ? places
      : places.filter((place) =>
          `${nameOf(place)} ${typeOf(place)}`.toLowerCase().includes(needle),
        );
  return (
    <section className="map-places" aria-label={t('map.places')}>
      <header className="map-panel-head">
        <h2 className="map-panel-title">{t('map.places')}</h2>
        <HelpTip>{t('map.hint')}</HelpTip>
        <button type="button" className="btn" onClick={onClose}>
          {t('ui.close')}
        </button>
      </header>
      <input
        type="search"
        className="map-places-search"
        value={query}
        aria-label={t('map.search')}
        placeholder={t('map.search')}
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul className="map-places-list">
        {shown.map((place) => (
          <li key={place.id}>
            <button type="button" className="map-place" onClick={() => onSelect(place.id)}>
              <span className="map-place-name">{nameOf(place)}</span>
              <span className="map-place-type">{typeOf(place)}</span>
              <RiskBadge band={place.risk} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
