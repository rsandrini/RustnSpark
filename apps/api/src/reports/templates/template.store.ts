import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LOCALES } from './template.placeholders.js';
import { setTemplateOverrides, type TemplateOverride } from './template.engine.js';

/** How long the wording read from the database is trusted before it is read again (other processes' edits). */
const TTL_MS = 10_000;

let loadedAt = 0;

/** An Admin edit of the wording: the next render in this process reads it again. */
export function invalidateReportTemplates(): void {
  loadedAt = 0;
}

function listOf(value: unknown, locale: string): string[] {
  if (typeof value !== 'object' || value === null) return [];
  const list = (value as Record<string, unknown>)[locale];
  return Array.isArray(list) ? list.filter((line): line is string => typeof line === 'string') : [];
}

/** Keeps the template engine's overrides in step with the ReportTemplate table. */
@Injectable()
export class ReportTemplateStore {
  constructor(private readonly prisma: PrismaService) {}

  async ensureFresh(): Promise<void> {
    if (Date.now() - loadedAt < TTL_MS) return;
    const rows = await this.prisma.reportTemplate.findMany();
    const next = new Map<string, TemplateOverride>();
    for (const row of rows) {
      for (const locale of LOCALES) {
        next.set(`${locale}/${row.id}`, {
          variants: listOf(row.variants, locale),
          legacy: listOf(row.legacy, locale),
        });
      }
    }
    setTemplateOverrides(next);
    loadedAt = Date.now();
  }
}
