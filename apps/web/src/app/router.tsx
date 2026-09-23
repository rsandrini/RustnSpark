import { createBrowserRouter, Outlet, RouterProvider } from 'react-router-dom';
import { AuthProvider } from '../features/auth/auth.context';
import { LoginPage } from '../features/auth/login.page';
import { RegisterPage } from '../features/auth/register.page';
import { ProtectedRoute } from '../features/auth/protected-route';
import { AdminRoute } from '../features/auth/admin-route';
import { AdminShell } from '../features/admin/admin-shell';
import { HomePage } from '../pages/home.page';
import { NotFoundPage } from '../pages/not-found.page';

function RootLayout() {
  return (
    <AuthProvider>
      <Outlet />
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
        path: '/admin/*',
        element: (
          <ProtectedRoute>
            <AdminRoute>
              <AdminShell />
            </AdminRoute>
          </ProtectedRoute>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

const browserRouter = createBrowserRouter(routes);

export function AppRouter() {
  return <RouterProvider router={browserRouter} />;
}
