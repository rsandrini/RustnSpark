import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './auth.hooks';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div aria-live="polite">{t('loading')}</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// Game routes additionally need a chosen faction: without one there is no ship, port
// or board to show, so the player is sent to /onboarding first (S10.2).
export function RequireFaction({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div aria-live="polite">{t('loading')}</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!user.factionId) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
