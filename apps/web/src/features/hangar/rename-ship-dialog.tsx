import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import { describeError } from '../../api/errors';
import { useIntentKey } from '../../api/intent-key';
import { Popup } from '../../ui/Popup';

const MAX_LENGTH = 20;

interface RenameQuote {
  prefix: string;
  price: number;
  name: string;
}

/** Renaming the ship for a fee: the faction prefix is fixed, the rest of the name is the pilot's. */
export function RenameShipDialog({
  shipId,
  open,
  onClose,
}: {
  shipId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const quoteQuery = useQuery({
    queryKey: ['renameQuote', shipId],
    queryFn: () => client.get<RenameQuote>(`/v1/ships/${shipId}/rename`),
    enabled: open,
  });
  const quote = quoteQuery.data;
  const [draft, setDraft] = useState<string | null>(null);
  // Starts from the pilot's current part of the name.
  const current = quote === undefined ? '' : quote.name.slice(quote.prefix.length);
  const value = draft ?? current;
  const money = (amount: number) => `${new Intl.NumberFormat(i18n.language).format(amount)} ¢`;

  // One key per intent: a retry of the same name reuses it, so a lost response can never charge twice.
  const intent = useIntentKey();
  const save = useMutation({
    mutationFn: () =>
      client.post<RenameQuote>(
        `/v1/ships/${shipId}/rename`,
        { name: value },
        { idempotencyKey: intent.keyFor(value) },
      ),
    onSuccess: () => {
      intent.clear();
      void queryClient.invalidateQueries({ queryKey: ['ships'] });
      void queryClient.invalidateQueries({ queryKey: ['renameQuote', shipId] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      close();
    },
  });

  const close = () => {
    setDraft(null);
    save.reset();
    onClose();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!save.isPending && value.trim() !== '') save.mutate();
  };

  return (
    <Popup open={open} title={t('hangar.rename.title')} onClose={close}>
      <form onSubmit={submit}>
        <p className="sub">{t('hangar.rename.help')}</p>
        <label className="field">
          <span className="label">{t('hangar.rename.label')}</span>
          <span className="rename-row">
            <b className="rename-prefix" data-testid="rename-prefix">
              {quote?.prefix ?? ''}
            </b>
            <input
              value={value}
              maxLength={MAX_LENGTH}
              autoComplete="off"
              onChange={(event) => setDraft(event.target.value)}
            />
          </span>
        </label>
        {quote !== undefined && (
          <p className="sub" data-testid="rename-price">
            {t('hangar.rename.price', { price: money(quote.price) })}
          </p>
        )}
        {save.isError && (
          <p role="alert" className="error">
            {describeError(t, save.error, t('hangar.rename.failed'))}
          </p>
        )}
        <button
          type="submit"
          className="btn primary"
          disabled={quote === undefined || value.trim() === '' || save.isPending}
        >
          {save.isPending ? t('hangar.rename.saving') : t('hangar.rename.save')}
        </button>
      </form>
    </Popup>
  );
}
