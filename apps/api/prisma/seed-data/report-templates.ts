import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PrismaClient } from '@prisma/client';
import { TEMPLATE_PLACEHOLDERS } from '../../src/reports/templates/template.placeholders.js';

const LOCALES = ['en', 'pt-BR'] as const;

type Wording = Record<(typeof LOCALES)[number], string[]>;

function fileOf(locale: string, type: string): { variants?: string[]; legacy?: string[] } {
  const url = new URL(`../../src/reports/templates/${locale}/${type}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as { variants?: string[]; legacy?: string[] };
}

/** The wording the repo files carry for every event type: the seed of the ReportTemplate table. */
export function reportTemplateSeed(): Array<{
  id: string;
  variants: Wording;
  legacy: Partial<Wording>;
}> {
  return Object.keys(TEMPLATE_PLACEHOLDERS).map((id) => {
    const variants = {} as Wording;
    const legacy: Partial<Wording> = {};
    for (const locale of LOCALES) {
      const file = fileOf(locale, id);
      variants[locale] = file.variants ?? [];
      if (file.legacy !== undefined) legacy[locale] = file.legacy;
    }
    return { id, variants, legacy };
  });
}

export function hashOfWording(variants: unknown, legacy: unknown): string {
  return createHash('sha1').update(JSON.stringify({ variants, legacy })).digest('hex');
}

/**
 * Writes the report wording into the table. A missing row is created; a row the Admin never touched (its
 * content still hashes to what the seed last wrote) follows the repo files; an edited row is left alone.
 */
export async function seedReportTemplates(prisma: PrismaClient): Promise<void> {
  for (const { id, variants, legacy } of reportTemplateSeed()) {
    const seedHash = hashOfWording(variants, legacy);
    const row = await prisma.reportTemplate.findUnique({ where: { id } });
    if (row === null) {
      await prisma.reportTemplate.create({ data: { id, variants, legacy, seedHash } });
    } else if (row.seedHash === hashOfWording(row.variants, row.legacy)) {
      await prisma.reportTemplate.update({ where: { id }, data: { variants, legacy, seedHash } });
    }
  }
}
