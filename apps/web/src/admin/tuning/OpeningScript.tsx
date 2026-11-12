import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { pickLocalized } from '../../i18n/localized';
import { SCENE_TRIGGERS, type SceneData } from './SceneEditor';
import { inSequence } from './scene-edit';
import { tuningApi } from './tuning.api';

interface Giver {
  id: string;
  name: string;
  factionId: string;
  scenes: SceneData[];
}

/** The faction of the new-pilot opening's guides. */
const OPENING_FACTION = 'free';

/**
 * The whole opening as one script: every line of every guide, in the order the story is told, with who says it and
 * when, and a search over all of it. Read-only: each row links to the guide's own form to edit.
 */
export function OpeningScript() {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState('');
  const givers = useQuery({
    queryKey: ['tuning', 'entities', 'quest-givers'],
    queryFn: () => tuningApi.listEntities<Giver>('quest-givers'),
  });
  const language = i18n.language === 'pt-BR' ? 'pt-BR' : 'en';

  const rows = useMemo(() => {
    const guides = (givers.data ?? []).filter((giver) => giver.factionId === OPENING_FACTION);
    const all = guides.flatMap((guide) =>
      (Array.isArray(guide.scenes) ? guide.scenes : []).map((scene) => ({ guide, scene })),
    );
    const ordered = inSequence(
      all.map((entry) => entry.scene),
      SCENE_TRIGGERS,
    );
    // `inSequence` hands back each scene with its place in `all`, which says whose it is
    return ordered.map(({ index }) => all[index]!);
  }, [givers.data]);

  const needle = search.trim().toLowerCase();
  const shown = rows.filter(({ guide, scene }) => {
    if (needle === '') return true;
    const text = scene.nodes.flatMap((node) => [node.text.en, node.text['pt-BR']]).join(' ');
    return `${guide.name} ${text} ${scene.id}`.toLowerCase().includes(needle);
  });

  if (givers.isLoading) return <p>{t('tuning.loading')}</p>;

  return (
    <div className="opening-script">
      <h2>{t('admin.openingScript.title')}</h2>
      <p className="muted">{t('admin.openingScript.help')}</p>
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('admin.openingScript.search')}
        aria-label={t('admin.openingScript.search')}
      />
      {shown.length === 0 && <p className="muted">{t('admin.openingScript.none')}</p>}
      <table className="opening-script-table">
        <thead>
          <tr>
            <th>{t('admin.openingScript.number')}</th>
            <th>{t('admin.openingScript.moment')}</th>
            <th>{t('admin.openingScript.who')}</th>
            <th>{t('admin.openingScript.lines')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {shown.map(({ guide, scene }) => (
            <tr key={`${guide.id}-${scene.id}-${scene.trigger}`}>
              <td>{rows.findIndex((row) => row.scene === scene) + 1}</td>
              <td>{t(`admin.dialogue.triggers.${scene.trigger}`)}</td>
              <td>{guide.name}</td>
              <td>
                <ol className="opening-script-lines">
                  {scene.nodes.map((node) => (
                    <li key={node.id}>{pickLocalized(node.text, language)}</li>
                  ))}
                </ol>
              </td>
              <td>
                <Link to={`/admin/tuning/entities/quest-givers/${encodeURIComponent(guide.id)}`}>
                  {t('admin.openingScript.edit')}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
