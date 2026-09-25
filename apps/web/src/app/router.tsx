import { createBrowserRouter, Outlet } from 'react-router';
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
import { BoardPage } from '../features/board/board.page';
import { TransitPage } from '../features/transit/transit.page';
import { ReportPage } from '../features/report/report.page';
import { PortPage } from '../features/port/port.page';
import { ProfilePage } from '../features/profile/profile.page';
import { GameNav } from '../ui/GameNav';
import { NoticeBanner } from '../ui/NoticeBanner';
import { HomePage } from '../pages/home.page';
import { NotFoundPage } from '../pages/not-found.page';

const AdminRoutes = lazy(() => import('../admin/admin-routes'));

function AdminFallback() {
  const { t } = useTranslation();
  return <p>{t('tuning.loading')}</p>;
}

function AppChrome() {
  const { user } = useAuthContext();
  const inGame = user?.factionId != null;
  return (
    <>
      {inGame && <NoticeBanner />}
      {inGame && <GameNav />}
      <Outlet />
    </>
  );
}

function RootLayout() {
  return (
    <AuthProvider>
      <LanguageSwitcher />
      <AppChrome />
    </AuthProvider>
  );
}

export const routes = [
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <HomePage /> },
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
      {
        path: '/board',
        element: (
          <ProtectedRoute>
            <RequireFaction>
              <BoardPage />
            </RequireFaction>
          </ProtectedRoute>
        ),
      },
      {
        path: '/transit',
        element: (
          <ProtectedRoute>
            <RequireFaction>
              <TransitPage />
            </RequireFaction>
          </ProtectedRoute>
        ),
      },
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
        path: '/port',
        element: (
          <ProtectedRoute>
            <RequireFaction>
              <PortPage />
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
