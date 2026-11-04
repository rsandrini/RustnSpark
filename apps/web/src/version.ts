import pkg from '../package.json';

/** The release the player is on, as shown in the account menu: "v0.1" (major.minor of the web package). */
export const APP_VERSION = `v${pkg.version.split('.').slice(0, 2).join('.')}`;
