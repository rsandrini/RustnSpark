import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../i18n/language-switcher';
import { AuthProvider, useAuthContext } from '../features/auth/auth.context';
import { LoginPage } from '../features/auth/login.page';
import { RegisterPage } from '../features/auth/register.page';
import { ProtectedRoute, RequireFaction } from '../features/auth/protected-route';
import { AdminRoute } from '../features/auth/admin-route';
import { OnboardingRoute } from '../features/onboarding/onboarding.page';
import { HangarPage } from '../features/hangar/hangar.page';
import { MapPage } from '../features/map/map.page';
import { ReportPage } from '../features/report/report.page';
import { ProfilePage } from '../features/profile/profile.page';
import { TopBar } from '../ui/TopBar';
import { useWalletSync } from '../features/transit/use-active-mission';
import { NoticeBanner } from '../ui/NoticeBanner';
import { NotFoundPage } from '../pages/not-found.page';

const AdminRoutes = lazy(() => import('../admin/admin-routes'));

function AdminFallback() {
  const { t } = useTranslation();
  return <p>{t('tuning.loading')}</p>;
}

function InGameChrome() {
  useWalletSync();
  return (
    <>
      <TopBar />
      <NoticeBanner />
    </>
  );
}

function AppChrome() {
  const { user } = useAuthContext();
  const inGame = user?.factionId != null;
  return (
    <>
      {inGame ? <InGameChrome /> : <LanguageSwitcher />}
      <Outlet />
    </>
  );
}

function RootLayout() {
  return (
    <AuthProvider>
      <AppChrome />
    </AuthProvider>
  );
}

export const routes = [
  {
    element: <RootLayout />,
    children: [
      {
        // Home was retired (round-3 nav consolidation): My Ship (the Hangar) is the landing
        // page. The guard chain still does the right thing for every visitor: no session →
        // /login (ProtectedRoute); no faction yet → /onboarding (RequireFaction); otherwise →
        // /hangar.
        path: '/',
        element: (
          <ProtectedRoute>
            <RequireFaction>
              <Navigate to="/hangar" replace />
            </RequireFaction>
          </ProtectedRoute>
        ),
      },
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      {
        path: '/onboarding',
        element: (
          <ProtectedRoute>
            <OnboardingRoute />
          </ProtectedRoute>
        ),
      },
      {
        path: '/hangar',
        element: (
          <ProtectedRoute>
            <RequireFaction>
              <HangarPage />
            </RequireFaction>
          </ProtectedRoute>
        ),
      },
      {
        path: '/map',
        element: (
          <ProtectedRoute>
            <RequireFaction>
              <MapPage />
            </RequireFaction>
          </ProtectedRoute>
        ),
      },
      // Board, Transit and Port folded into My Ship as gated tabs/sections (round-3 nav
      // consolidation); these three routes stay only as redirects for any stray bookmark/link.
      { path: '/board', element: <Navigate to="/hangar" replace /> },
      { path: '/transit', element: <Navigate to="/hangar" replace /> },
      { path: '/port', element: <Navigate to="/hangar" replace /> },
      {
        path: '/report/:missionId',
        element: (
          <ProtectedRoute>
            <RequireFaction>
              <ReportPage />
            </RequireFaction>
          </ProtectedRoute>
        ),
      },
      {
        path: '/profile',
        element: (
          <ProtectedRoute>
            <RequireFaction>
              <ProfilePage />
            </RequireFaction>
          </ProtectedRoute>
        ),
      },
      {
        path: '/admin/*',
        element: (
          <ProtectedRoute>
            <AdminRoute>
              <Suspense fallback={<AdminFallback />}>
                <AdminRoutes />
              </Suspense>
            </AdminRoute>
          </ProtectedRoute>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

const browserRouter = createBrowserRouter(routes, {});

export function AppRouter() {
  return <RouterProvider router={browserRouter} />;
}
