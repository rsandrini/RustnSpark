import { SECTIONS, TOPIC_IDS, type TopicId } from './guide-model';

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface SearchEntry {
  topic: TopicId;
  section: string;
  title: string;
  topicTitle: string;
  haystack: string;
  titleHaystack: string;
}

export interface TopicHit {
  topic: TopicId;
  section: string | null;
  title: string;
  topicTitle: string;
  score: number;
}

/** Lower case and no accents, so "mineracao" finds "mineração" and "Escudo" finds "escudo". */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** One entry per topic and per section, built from the texts in the language on screen (with the live
    numbers filled in, so a search for "0.45" would find the fuel price too). */
export function buildIndex(t: Translate, values: Record<string, string>): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const topic of TOPIC_IDS) {
    const topicTitle = t(`guide.topics.${topic}.title`);
    const keywords = t(`guide.topics.${topic}.keywords`);
    const summary = t(`guide.topics.${topic}.summary`);
    entries.push({
      topic,
      section: '',
      title: topicTitle,
      topicTitle,
      titleHaystack: normalize(`${topicTitle} ${keywords}`),
      haystack: normalize(`${topicTitle} ${keywords} ${summary}`),
    });
    for (const section of SECTIONS[topic]) {
      const title = t(`guide.topics.${topic}.sections.${section}.title`);
      const text = t(`guide.topics.${topic}.sections.${section}.text`, values);
      entries.push({
        topic,
        section,
        title,
        topicTitle,
        titleHaystack: normalize(`${title} ${topicTitle}`),
        haystack: normalize(`${title} ${text}`),
      });
    }
  }
  return entries;
}

/** Every word of the query must appear; a hit in a title or keyword counts for more than one in the text. */
export function searchTopics(index: readonly SearchEntry[], query: string, limit = 8): TopicHit[] {
  const words = normalize(query)
    .split(/\s+/)
    .filter((word) => word !== '');
  if (words.length === 0) return [];
  const hits: TopicHit[] = [];
  for (const entry of index) {
    if (!words.every((word) => entry.haystack.includes(word))) continue;
    const inTitle = words.every((word) => entry.titleHaystack.includes(word));
    hits.push({
      topic: entry.topic,
      section: entry.section === '' ? null : entry.section,
      title: entry.title,
      topicTitle: entry.topicTitle,
      score: (inTitle ? 10 : 1) + (entry.section === '' ? 1 : 0),
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface CatalogPart {
  partType: string;
  displayName: string;
  partClass: string;
}

/** Parts whose name contains every word of the query. */
export function searchParts(
  parts: readonly CatalogPart[],
  query: string,
  limit = 8,
): CatalogPart[] {
  const words = normalize(query)
    .split(/\s+/)
    .filter((word) => word !== '');
  if (words.length === 0) return [];
  // The catalog lists a part once per rarity and size; the Guide shows each name once.
  const seen = new Set<string>();
  return parts
    .filter((part) => {
      const name = normalize(part.displayName);
      if (!words.every((word) => name.includes(word))) return false;
      const key = `${name}|${part.partClass}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
