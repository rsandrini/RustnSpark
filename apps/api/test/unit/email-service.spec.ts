import { describe, expect, it, jest } from '@jest/globals';
import { EmailService } from '../../src/email/email.service.js';

// The Resend SDK answers a refused send with `{ error }` instead of throwing: the service must turn that
// into a failure, or the callers report success for a mail that never left.
const build = (result: { data: unknown; error: unknown }) => {
  const config = {
    get: (key: string) =>
      ({
        RESEND_API_KEY: 're_test',
        RESEND_FROM_NAME: 'Game',
        RESEND_FROM_EMAIL: 'noreply@x.test',
      })[key],
  };
  const service = new EmailService(config as never);
  const send = jest.fn((_message: unknown) => Promise.resolve(result));
  (service as unknown as { resend: unknown }).resend = { emails: { send } };
  return { service, send };
};

describe('EmailService.sendTemplate', () => {
  it('sends from the configured name and address', async () => {
    const { service, send } = build({ data: { id: '1' }, error: null });
    await service.sendTemplate('a@b.test', 'Hi', '<p>x</p>');
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Game <noreply@x.test>', to: ['a@b.test'] }),
    );
  });

  it('throws when the provider refuses the send', async () => {
    const { service } = build({
      data: null,
      error: { name: 'validation_error', message: 'The domain is not verified' },
    });
    await expect(service.sendTemplate('a@b.test', 'Hi', '<p>x</p>')).rejects.toThrow(
      'validation_error: The domain is not verified',
    );
  });
});
