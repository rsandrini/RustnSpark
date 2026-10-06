import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router';
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
import { ForgotPasswordPage } from '../features/auth/forgot-password.page';
import { ResetPasswordPage } from '../features/auth/reset-password.page';

const AdminRoutes = lazy(() => import('../admin/admin-routes'));

function AdminFallback() {
  const { t } = useTranslation();
  return <p>{t('tuning.loading')}</p>;
}

/** Board/Transit/Port are real nested routes under /hangar again (reversing the query-param
    form of the round-3 nav consolidation — Port and Board are reachable from the top nav now,
    not just a tab inside My Ship); these three bare paths stay only as redirects for any stray
    old bookmark/link, keeping whichever tab it meant to open and any other query string it
    carried (e.g. /board?location=X for the mission board's own origin filter). */
function RedirectToHangarTab({ tab }: { tab?: 'board' | 'port' }) {
  const location = useLocation();
  const path = tab === undefined ? '/hangar' : `/hangar/${tab}`;
  return <Navigate to={`${path}${location.search}`} replace />;
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
      {
        path: '/hangar/:tab?',
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
      // Bare bookmarks from before Port/Board got their own nested routes back.
      { path: '/board', element: <RedirectToHangarTab tab="board" /> },
      { path: '/transit', element: <RedirectToHangarTab /> },
      { path: '/port', element: <RedirectToHangarTab tab="port" /> },
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
