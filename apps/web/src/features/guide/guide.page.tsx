import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import type { PartCatalogListItem } from '../../api/generated';
import { PageTitle } from '../../ui/PageTitle';
import { useIsPhone } from '../../ui/useIsPhone';
import {
  CLASS_SECTION,
  SECTIONS,
  TOPIC_FIGURES,
  TOPIC_IDS,
  TOPIC_LINKS,
  guideValues,
  type TopicId,
} from './guide-model';
import { buildIndex, searchParts, searchTopics } from './guide-search';
import { useGuideRules } from './use-guide-rules';

const isTopic = (value: string | undefined): value is TopicId =>
  TOPIC_IDS.some((id) => id === value);

/** The in-game guide: a list of topics with a search box, and the open topic beside it (under it on phones). */
export function GuidePage() {
  const { t, i18n } = useTranslation();
  const { topic: topicParam } = useParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const rules = useGuideRules();
  const [query, setQuery] = useState('');
  const phone = useIsPhone();
  // On a phone /guide is the list; on a wider screen it opens on the first topic.
  const topic = isTopic(topicParam) ? topicParam : phone ? null : 'run';

  const values = useMemo(() => guideValues(rules, t, i18n.language), [rules, t, i18n.language]);
  const index = useMemo(() => buildIndex(t, values), [t, values]);
  const catalog = useQuery({
    queryKey: ['partsCatalog', i18n.language],
    queryFn: () => client.get<PartCatalogListItem[]>(`/v1/parts/catalog?locale=${i18n.language}`),
    staleTime: 10 * 60 * 1000,
  });

  const topicHits = useMemo(() => searchTopics(index, query), [index, query]);
  const partHits = useMemo(() => searchParts(catalog.data ?? [], query), [catalog.data, query]);
  const searching = query.trim() !== '';

  // Opening a link to a section (…/parts#defense) scrolls to it.
  useEffect(() => {
    if (hash === '' || topic === null) return;
    document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: 'start' });
  }, [hash, topic]);

  const goto = (to: string) => {
    setQuery('');
    void navigate(to);
  };
  const hitPath = (hit: { topic: TopicId; section: string | null }) =>
    `/guide/${hit.topic}${hit.section === null ? '' : `#${hit.section}`}`;

  return (
    <main className="app wide guide" data-testid="guide">
      <PageTitle title={t('guide.title')} line={t('guide.line', { count: TOPIC_IDS.length })} />
      <div className={`guide-layout${topic !== null ? ' has-topic' : ''}`}>
        <nav className="guide-side" aria-label={t('guide.topicsHeading')}>
          <input
            type="search"
            className="input guide-search"
            aria-label={t('guide.searchLabel')}
            placeholder={t('guide.searchPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('');
              if (event.key === 'Enter') {
                const first = topicHits[0];
                const part = partHits[0];
                if (first !== undefined) goto(hitPath(first));
                else if (part !== undefined)
                  goto(`/guide/parts#${CLASS_SECTION[part.partClass] ?? 'sheet'}`);
              }
            }}
          />
          {searching ? (
            <div className="guide-results" data-testid="guide-results">
              {topicHits.length === 0 && partHits.length === 0 && (
                <p className="sub">{t('guide.noResults', { query: query.trim() })}</p>
              )}
              {topicHits.length > 0 && (
                <>
                  <h2 className="guide-list-title">{t('guide.sectionsHeading')}</h2>
                  <ul className="guide-list">
                    {topicHits.map((hit) => (
                      <li key={`${hit.topic}-${hit.section ?? ''}`}>
                        <Link to={hitPath(hit)} onClick={() => setQuery('')}>
                          <b>{hit.title}</b>
                          {hit.section !== null && <span>{hit.topicTitle}</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {partHits.length > 0 && (
                <>
                  <h2 className="guide-list-title">{t('guide.partsHeading')}</h2>
                  <ul className="guide-list">
                    {partHits.map((part) => (
                      <li key={part.partType}>
                        <Link
                          to={`/guide/parts#${CLASS_SECTION[part.partClass] ?? 'sheet'}`}
                          onClick={() => setQuery('')}
                        >
                          <b>{part.displayName}</b>
                          <span>
                            {t('guide.partResult', {
                              class: t(`hangar.partClasses.${part.partClass}`, {
                                defaultValue: part.partClass,
                              }),
                            })}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : (
            <>
              <h2 className="guide-list-title">{t('guide.topicsHeading')}</h2>
              <ul className="guide-list">
                {TOPIC_IDS.map((id) => (
                  <li key={id}>
                    <Link
                      to={`/guide/${id}`}
                      className={id === topic ? 'on' : undefined}
                      aria-current={id === topic ? 'page' : undefined}
                    >
                      <b>{t(`guide.topics.${id}.title`)}</b>
                      <span>{t(`guide.topics.${id}.summary`)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </nav>

        {topic !== null && (
          <article className="guide-topic" data-testid="guide-topic">
            <Link className="guide-back" to="/guide">
              {t('guide.back')}
            </Link>
            <h2 className="guide-topic-title">{t(`guide.topics.${topic}.title`)}</h2>
            <p className="guide-summary">{t(`guide.topics.${topic}.summary`)}</p>
            {SECTIONS[topic].map((section) => (
              <section key={section} id={section} className="guide-section">
                <h3>{t(`guide.topics.${topic}.sections.${section}.title`)}</h3>
                <p>{t(`guide.topics.${topic}.sections.${section}.text`, values)}</p>
              </section>
            ))}
            {(TOPIC_FIGURES[topic]?.length ?? 0) > 0 && rules !== undefined && (
              <aside className="guide-live" data-testid="guide-live">
                <h3>{t('guide.liveHeading')}</h3>
                <dl>
                  {TOPIC_FIGURES[topic]?.map((name) => (
                    <div key={name}>
                      <dt>{t(`guide.figures.${name}`)}</dt>
                      <dd>{values[name]}</dd>
                    </div>
                  ))}
                </dl>
                <p className="sub">{t('guide.liveNote')}</p>
              </aside>
            )}
            <div className="guide-links">
              {TOPIC_LINKS[topic].map((link) => (
                <Link key={link.to} className="btn" to={link.to}>
                  {t('guide.open', { where: t(`guide.where.${link.where}`) })}
                </Link>
              ))}
            </div>
          </article>
        )}
      </div>
    </main>
  );
}
