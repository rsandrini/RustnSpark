import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { ApiError } from '../../api/client';
import { useLogin } from './auth.hooks';
import { HeroShip, LandingStory, useLanding } from './landing';
import { RegisterForm } from './register-form';

export function LoginPage() {
  const { t } = useTranslation();
  const login = useLogin();
  const landing = useLanding();
  // One page for both: /register is the same landing with the panel on its Create account tab.
  const registering = useLocation().pathname === '/register';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    login.mutate({ email, password });
  };

  const rateLimited = login.error instanceof ApiError && login.error.status === 429;

  return (
    <main className="landing">
      <header className="landing-hero">
        <div className="landing-sky" aria-hidden="true" />
        <HeroShip />
        <div className="landing-hero-inner">
          <div className="landing-copy">
            <p className="landing-kicker">{t('landing.kicker')}</p>
            <h1>{t('landing.title')}</h1>
            <p className="landing-pitch">{t('landing.pitch')}</p>
            {landing !== undefined && (
              <ul className="landing-facts" data-testid="landing-facts">
                <li>{t('landing.facts.parts', { count: landing.counts.parts })}</li>
                <li>{t('landing.facts.places', { count: landing.counts.places })}</li>
                <li>{t('landing.facts.factions', { count: landing.counts.factions })}</li>
              </ul>
            )}
          </div>
          <section className="panel landing-auth" aria-labelledby="auth-title">
            <div className="auth-tabs" role="tablist" aria-label={t('landing.authTabs')}>
              <Link
                role="tab"
                aria-selected={!registering}
                className={`auth-tab${registering ? '' : ' active'}`}
                to="/login"
              >
                {t('login.title')}
              </Link>
              <Link
                role="tab"
                aria-selected={registering}
                className={`auth-tab${registering ? ' active' : ''}`}
                to="/register"
              >
                {t('register.title')}
              </Link>
            </div>
            <h2 id="auth-title" className="sr-only">
              {registering ? t('register.title') : t('login.title')}
            </h2>
            {registering ? (
              <RegisterForm />
            ) : (
              <>
                <form onSubmit={handleSubmit}>
                  <div className="field">
                    <label className="lbl" htmlFor="email">
                      {t('login.emailLabel')}
                    </label>
                    <input
                      className="input"
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                  <div className="field">
                    <label className="lbl" htmlFor="password">
                      {t('login.passwordLabel')}
                    </label>
                    <input
                      className="input"
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                    />
                  </div>
                  <button className="btn primary block" type="submit" disabled={login.isPending}>
                    {t('login.submit')}
                  </button>

                  {login.isError && (
                    <p className="error-text" role="alert">
                      {t(rateLimited ? 'error.RATE_LIMITED' : 'login.error.invalidCredentials')}
                    </p>
                  )}
                </form>
                <p className="auth-alt">
                  <Link to="/forgot-password">{t('login.forgotPasswordLink')}</Link>
                </p>
              </>
            )}
          </section>
        </div>
      </header>
      <LandingStory landing={landing} />
    </main>
  );
}
