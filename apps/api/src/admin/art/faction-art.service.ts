import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EnvService } from '../../common/env/env.module.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export const ART_SLOTS = ['banner', 'logo', 'background'] as const;
export type ArtSlot = (typeof ART_SLOTS)[number];

const EXTENSION_OF: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};
const MIME_OF: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};
export const ART_MAX_BYTES = 1_500_000;
const HASH_LENGTH = 12;
const FILE_PATTERN = /^[a-z0-9_]+-(banner|logo|background)-[a-f0-9]{12}\.(png|jpg|webp|svg)$/;
const DEFAULT_ART_DIR = './data/art';
const FACTION_ID_PATTERN = /^[a-z0-9_]+$/;

type StoredArt = Partial<Record<ArtSlot, string>>;

export interface ArtUrls {
  readonly banner: string | null;
  readonly logo: string | null;
  readonly background: string | null;
}

const urlOf = (file: string | undefined): string | null =>
  file === undefined ? null : `/v1/art/${file}`;

/** What the bytes really are: a declared image type is never trusted on its own. */
function looksLike(mime: string, bytes: Buffer): boolean {
  switch (mime) {
    case 'image/png':
      return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg':
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/webp':
      return bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
    case 'image/svg+xml': {
      const text = bytes.toString('utf8').replace(/^\uFEFF/, '').trimStart();
      return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text);
    }
    default:
      return false;
  }
}

/** An SVG is a document, not just pixels: anything that can run code or pull other content is out. */
function svgIsSafe(bytes: Buffer): boolean {
  const text = bytes.toString('utf8');
  return !/<script|<foreignObject|<iframe|<object|<embed|\son[a-z]+\s*=|javascript:|<!ENTITY|xlink:href\s*=\s*["']\s*(https?:|\/\/|data:text)/i.test(
    text,
  );
}

// Admin-uploaded faction images. The built-in static files stay the defaults: a slot is only set
// once something is uploaded, and resetting removes the file and the slot again. Files are named by
// content hash so a replaced image gets a fresh URL (served immutable), and old files are deleted.
@Injectable()
export class FactionArtService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  private dir(): string {
    return this.env.get('ART_DIR') ?? DEFAULT_ART_DIR;
  }

  async upload(
    factionId: string,
    slot: ArtSlot,
    bytes: Buffer,
    mime: string,
    actor: string,
  ): Promise<{ slot: ArtSlot; url: string }> {
    const extension = EXTENSION_OF[mime];
    if (extension === undefined) {
      throw new BadRequestException({ error: 'ART_UNSUPPORTED_TYPE' });
    }
    if (bytes.length === 0 || bytes.length > ART_MAX_BYTES) {
      throw new BadRequestException({ error: 'ART_BAD_SIZE', maxBytes: ART_MAX_BYTES });
    }
    if (!looksLike(mime, bytes) || (mime === 'image/svg+xml' && !svgIsSafe(bytes))) {
      throw new BadRequestException({ error: 'ART_NOT_AN_IMAGE' });
    }
    const faction = await this.requireFaction(factionId);
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, HASH_LENGTH);
    const file = `${factionId}-${slot}-${hash}.${extension}`;
    await mkdir(this.dir(), { recursive: true });
    await writeFile(join(this.dir(), file), bytes);

    const before = (faction.art ?? {}) as StoredArt;
    const after: StoredArt = { ...before, [slot]: file };
    await this.save(factionId, before, after, actor, `upload ${slot}`);
    await this.removeIfUnused(before[slot], factionId, after);
    return { slot, url: `/v1/art/${file}` };
  }

  async reset(factionId: string, slot: ArtSlot, actor: string): Promise<{ slot: ArtSlot; url: null }> {
    const faction = await this.requireFaction(factionId);
    const before = (faction.art ?? {}) as StoredArt;
    if (before[slot] === undefined) return { slot, url: null };
    const { [slot]: removed, ...rest } = before;
    await this.save(factionId, before, rest, actor, `reset ${slot}`);
    await this.removeIfUnused(removed, factionId, rest);
    return { slot, url: null };
  }

  /** Every faction with at least one uploaded image (the rest use the built-in defaults). */
  async listUrls(): Promise<Record<string, ArtUrls>> {
    const rows = await this.prisma.faction.findMany({ select: { id: true, art: true } });
    const out: Record<string, ArtUrls> = {};
    for (const row of rows) {
      const art = (row.art ?? {}) as StoredArt;
      if (ART_SLOTS.every((slot) => art[slot] === undefined)) continue;
      out[row.id] = {
        banner: urlOf(art.banner),
        logo: urlOf(art.logo),
        background: urlOf(art.background),
      };
    }
    return out;
  }

  /** One stored file for serving; names are validated, never joined from raw input. */
  async read(file: string): Promise<{ bytes: Buffer; mime: string }> {
    if (!FILE_PATTERN.test(file)) throw new NotFoundException();
    const extension = file.slice(file.lastIndexOf('.') + 1);
    try {
      return { bytes: await readFile(join(this.dir(), file)), mime: MIME_OF[extension] ?? 'application/octet-stream' };
    } catch {
      throw new NotFoundException();
    }
  }

  private async requireFaction(factionId: string): Promise<{ id: string; art: unknown }> {
    if (!FACTION_ID_PATTERN.test(factionId)) throw new NotFoundException();
    const faction = await this.prisma.faction.findUnique({
      where: { id: factionId },
      select: { id: true, art: true },
    });
    if (faction === null) throw new NotFoundException('faction not found');
    return faction;
  }

  private async save(
    factionId: string,
    before: StoredArt,
    after: StoredArt,
    actor: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.faction.update({
        where: { id: factionId },
        data: {
          art: Object.keys(after).length === 0 ? Prisma.DbNull : (after as Prisma.InputJsonValue),
        },
      });
      await tx.tuningRevision.create({
        data: {
          actor,
          entityType: 'factions',
          entityId: factionId,
          before: { art: before },
          after: { art: after },
          reason,
        },
      });
    });
  }

  private async removeIfUnused(file: string | undefined, factionId: string, kept: StoredArt): Promise<void> {
    if (file === undefined || Object.values(kept).includes(file)) return;
    void factionId;
    await rm(join(this.dir(), file), { force: true });
  }
}
