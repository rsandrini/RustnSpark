import { GameNav } from './GameNav';
import { AccountMenu } from './AccountMenu';
import { LanguageSwitcher } from '../i18n/language-switcher';

/**
 * The in-game top bar: game nav (My Ship / Map), language and account menu (Profile / Admin /
 * Logout) all in one row instead of three separate stacked bars.
 */
export function TopBar() {
  return (
    <header className="top-bar">
      <GameNav />
      <div className="top-bar-right">
        <LanguageSwitcher />
        <AccountMenu />
      </div>
    </header>
  );
}
