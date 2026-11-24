import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { reasonLabel } from './reason-label';

describe('reasonLabel', () => {
  it.each(['en', 'pt-BR'])(
    'a code only in hangar.problems resolves to its translated text (%s)',
    (lng) => {
      const t = i18n.getFixedT(lng);
      const text = reasonLabel(t, 'LIFE_SUPPORT_UNPOWERED', 'server english');
      expect(text).toBe(t('hangar.problems.LIFE_SUPPORT_UNPOWERED'));
      expect(text).not.toBe('server english');
    },
  );

  it('an unknown code falls back to the message', () => {
    expect(reasonLabel(i18n.getFixedT('en'), 'NOPE_NOT_A_CODE', 'plain message')).toBe(
      'plain message',
    );
  });
});
