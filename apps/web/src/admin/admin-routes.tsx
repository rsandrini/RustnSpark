import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Route, Routes } from 'react-router';
import { AdminShell } from '../features/admin/admin-shell';
import { DashboardScreen } from './analytics/DashboardScreen';
import { EconomyScreen } from './analytics/EconomyScreen';
import { WorldScreen } from './analytics/WorldScreen';
import { InspectorDetailScreen, InspectorListScreen } from './inspector/InspectorScreen';
import { SystemScreen } from './system/SystemScreen';
import { ConfigScreen } from './tuning/ConfigScreen';
import { EntityFormScreen } from './tuning/EntityFormScreen';
import { EntityScreen } from './tuning/EntityScreen';
import { RevisionHistory } from './tuning/RevisionHistory';

function AdminFallback() {
  const { t } = useTranslation();
  return <p>{t('tuning.loading')}</p>;
}

export default function AdminRoutes() {
  return (
    <Suspense fallback={<AdminFallback />}>
      <Routes>
        <Route element={<AdminShell />}>
          <Route index element={<DashboardScreen />} />
          <Route path="analytics/economy" element={<EconomyScreen />} />
          <Route path="analytics/world" element={<WorldScreen />} />
          <Route path="players" element={<InspectorListScreen />} />
          <Route path="players/:playerId" element={<InspectorDetailScreen />} />
          <Route path="system" element={<SystemScreen />} />
          <Route path="tuning/config" element={<ConfigScreen />} />
          <Route path="tuning/entities/:entity" element={<EntityScreen />} />
          <Route path="tuning/entities/:entity/new" element={<EntityFormScreen mode="new" />} />
          <Route path="tuning/entities/:entity/:id" element={<EntityFormScreen mode="edit" />} />
          <Route path="tuning/entities/:entity/:id/clone" element={<EntityFormScreen mode="clone" />} />
          <Route path="tuning/revisions" element={<RevisionHistory />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
