import { Link } from 'react-router';
import { GameNav } from './GameNav';
import { AccountMenu } from './AccountMenu';
import { StatusStrip } from './ShipIdentity';
import { useIsPhone } from './useIsPhone';

/** The wordmark, split so the "n" can take the accent colour (it is a brand, not a translation). */
const BRAND = ['rust', 'n', 'spark'] as const;

/**
 * The in-game shell: a slim top bar (wordmark, the four places, wallet and the account menu), the
 * status strip under it (who flies what, where, doing what) and, on a phone, the same four places
 * as a bottom tab bar instead of the top row.
 */
export function TopBar() {
  const phone = useIsPhone();
  return (
    <>
      <header className="shell-top">
        <div className="shell-top-in">
          <Link className="brand" to="/ship" aria-label="rustnspark">
            {BRAND[0]}
            <b>{BRAND[1]}</b>
            {BRAND[2]}
          </Link>
          {!phone && <GameNav />}
          <span className="spacer" />
          <AccountMenu />
        </div>
      </header>
      <StatusStrip />
      {phone && <GameNav bar />}
    </>
  );
}
