import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Route, Routes } from 'react-router-dom';
import { AdminShell } from '../features/admin/admin-shell';
import { ConfigScreen } from './tuning/ConfigScreen';
import { EntityScreen } from './tuning/EntityScreen';
import { RevisionHistory } from './tuning/RevisionHistory';

function AdminFallback() {
  const { t } = useTranslation();
  return <p>{t('tuning.loading')}</p>;
}

function AdminDashboard() {
  const { t } = useTranslation();
  return <p>{t('tuning.dashboardPlaceholder')}</p>;
}

export default function AdminRoutes() {
  return (
    <Suspense fallback={<AdminFallback />}>
      <Routes>
        <Route element={<AdminShell />}>
          <Route path="tuning/config" element={<ConfigScreen />} />
          <Route path="tuning/entities/:entity" element={<EntityScreen />} />
          <Route path="tuning/revisions" element={<RevisionHistory />} />
          <Route index element={<AdminDashboard />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
