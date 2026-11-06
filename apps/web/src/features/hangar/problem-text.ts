import { useTranslation } from 'react-i18next';
import { scaleSpeed, useDisplay } from '../../ui/display';

/**
 * The words for a ship problem. Mobility is read on the admin's display scale (x10 by default),
 * so "mobility is below 1" is spoken as the limit on that same scale, matching the sheet's tile.
 */
export function useProblemText(): (problem: { code: string; message: string }) => string {
  const { t } = useTranslation();
  const display = useDisplay();
  return (problem) =>
    t(`hangar.problems.${problem.code}`, {
      min: scaleSpeed(1, display),
      defaultValue: t(`error.${problem.code}`, { defaultValue: problem.message }),
    });
}
