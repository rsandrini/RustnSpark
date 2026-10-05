import { GameNav } from './GameNav';
import { AccountMenu } from './AccountMenu';
import { ShipIdentity } from './ShipIdentity';
import { LastMissionLink } from './LastMissionLink';
import { LanguageSwitcher } from '../i18n/language-switcher';

/**
 * The in-game top bar: game nav (My Ship / Port / Board / Map) on the left, faction + ship name
 * + current status/location in the middle, last-mission link + language + account menu on the
 * right — all in one row instead of separate stacked bars.
 */
export function TopBar() {
  return (
    <header className="top-bar">
      <GameNav />
      <ShipIdentity />
      <div className="top-bar-right">
        <LastMissionLink />
        <LanguageSwitcher />
        <AccountMenu />
      </div>
    </header>
  );
}
