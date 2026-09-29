import { GameNav } from './GameNav';
import { AccountMenu } from './AccountMenu';
import { ShipIdentity } from './ShipIdentity';
import { LanguageSwitcher } from '../i18n/language-switcher';

/**
 * The in-game top bar: game nav (My Ship / Map) on the left, faction + ship name in the
 * middle, language and account menu (Profile / Admin / Logout) on the right — all in one row
 * instead of three separate stacked bars.
 */
export function TopBar() {
  return (
    <header className="top-bar">
      <GameNav />
      <ShipIdentity />
      <div className="top-bar-right">
        <LanguageSwitcher />
        <AccountMenu />
      </div>
    </header>
  );
}
