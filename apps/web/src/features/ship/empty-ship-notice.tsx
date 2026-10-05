import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { client } from '../../api/client';
import type { ShipResponse } from '../../api/generated';

// A ship with nothing installed cannot take a mission. New pilots start with their kit loose
// (D44), so screens that lead to missions point them at the Hangar instead of leaving them
// wondering why nothing is takeable.
export function EmptyShipNotice() {
  const { t } = useTranslation();
  const shipsQuery = useQuery({
    queryKey: ['ships'],
    queryFn: () => client.get<ShipResponse[]>('/v1/ships'),
  });
  const ship = shipsQuery.data?.[0];
  if (ship === undefined || ship.layout.length > 0) return null;
  return (
    <div className="panel kit-note" role="note">
      <b>{t('ship.empty.title')}</b>
      <p className="muted">{t('ship.empty.body')}</p>
      <Link className="btn primary" to="/hangar">
        {t('ship.empty.action')}
      </Link>
    </div>
  );
}
