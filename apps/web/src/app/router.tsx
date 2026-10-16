import { createBrowserRouter, Navigate, Outlet, useLocation, useParams } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../i18n/language-switcher';
import { AuthProvider, useAuthContext } from '../features/auth/auth.context';
import { LoginPage } from '../features/auth/login.page';
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
import { ForgotPasswordPage } from '../features/auth/forgot-password.page';
import { ResetPasswordPage } from '../features/auth/reset-password.page';

const AdminRoutes = lazy(() => import('../admin/admin-routes'));

function AdminFallback() {
  const { t } = useTranslation();
  return <p>{t('tuning.loading')}</p>;
}

/** The game's four places: Ship, Port, Missions and Map (phase 2 of the redesign). Ship, Port and
    Missions are all served by HangarPage, which reads its tab from the path. The old paths
    (/hangar, /hangar/port, /hangar/board, /board, /transit) stay for good as redirects for any
    bookmark or stray link; each keeps the query string it carried (e.g. /board?location=X for the
    mission board's own origin filter). */
function RedirectTo({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}`} replace />;
}

/** `/hangar/:tab`: the old nested form, mapped to the new path of the tab it named. */
function RedirectFromHangarTab() {
  const { tab } = useParams<{ tab?: string }>();
  const to = tab === 'board' ? '/missions' : tab === 'port' ? '/port' : '/ship';
  return <RedirectTo to={to} />;
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
        // /ship.
        path: '/',
        element: (
          <ProtectedRoute>
            <RequireFaction>
              <Navigate to="/ship" replace />
            </RequireFaction>
          </ProtectedRoute>
        ),
      },
      { path: '/login', element: <LoginPage /> },
      // sign-in and sign-up share one page: the landing, with the panel on its Create account tab
      { path: '/register', element: <LoginPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      {
        path: '/onboarding',
        element: (
          <ProtectedRoute>
            <OnboardingRoute />
          </ProtectedRoute>
        ),
      },
      ...(['/ship', '/port', '/missions'] as const).map((path) => ({
        path,
        element: (
          <ProtectedRoute>
            <RequireFaction>
              <HangarPage />
            </RequireFaction>
          </ProtectedRoute>
        ),
      })),
      { path: '/hangar', element: <RedirectTo to="/ship" /> },
      { path: '/hangar/:tab', element: <RedirectFromHangarTab /> },
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
      // Bare bookmarks from before the four-place navigation.
      { path: '/board', element: <RedirectTo to="/missions" /> },
      { path: '/transit', element: <RedirectTo to="/ship" /> },
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
