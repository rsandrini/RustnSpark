import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { portraitUrlOf } from '../../missions/giver-ref.js';
import { parsePools } from '../../missions/voice.js';
import { bilingual } from '../../parts/parts.service.js';
import { ArtService, type ArtUrls } from './art.service.js';

/** A faction as players see it: names, pitch, colour and any uploaded images — all admin-owned. */
export interface PublicFaction {
  readonly id: string;
  readonly displayName: { readonly en: string; readonly 'pt-BR': string };
  readonly description: { readonly en: string; readonly 'pt-BR': string };
  readonly color: string;
  readonly playable: boolean;
  /** Uploaded banner/logo/background URLs; null = no uploads (built-in defaults apply). */
  readonly art: ArtUrls | null;
  /** The faction's mentor, for the faction choice screen (absent in the sign-in page's list). */
  readonly mentor?: {
    readonly name: string;
    readonly title: { readonly en: string; readonly 'pt-BR': string };
    readonly portraitUrl: string | null;
    readonly welcome: { readonly en: string; readonly 'pt-BR': string } | null;
  } | null;
}

/** What the sign-in page may show anyone: the factions as the admin has them and a few catalog counts. */
export interface PublicLanding {
  readonly factions: PublicFaction[];
  readonly counts: { readonly parts: number; readonly places: number; readonly factions: number };
}

function mentorCardOf(
  mentor: { name: string; title: unknown; art: unknown; lines: unknown } | undefined,
): PublicFaction['mentor'] {
  if (mentor === undefined) return null;
  const welcome = parsePools(mentor.lines)['tutorial.welcome']?.[0];
  return {
    name: mentor.name,
    title: bilingual(mentor.title),
    portraitUrl: portraitUrlOf(mentor.art),
    welcome: welcome === undefined ? null : { en: welcome.en, 'pt-BR': welcome['pt-BR'] },
  };
}

/** What every signed-in player needs: which entities have uploaded images (the rest keep defaults). */
@Controller()
export class ArtPublicController {
  constructor(
    private readonly art: ArtService,
    private readonly prisma: PrismaService,
  ) {}

  // The faction list the player UI reads names, blurbs and colours from (not the language files):
  // what the admin edits is what players see.
  @Get('factions')
  async factions(): Promise<{ factions: PublicFaction[] }> {
    const [rows, art, mentors] = await Promise.all([
      this.prisma.faction.findMany({ orderBy: { id: 'asc' } }),
      this.art.listUrls('factions'),
      this.prisma.questGiver.findMany({ where: { role: 'MENTOR', active: true } }),
    ]);
    const mentorOf = new Map(mentors.map((mentor) => [mentor.factionId, mentor]));
    return {
      factions: rows.map((row) => ({
        id: row.id,
        displayName: row.displayName as PublicFaction['displayName'],
        description: row.description as PublicFaction['description'],
        color: row.color,
        playable: row.playable,
        art: art[row.id] ?? null,
        mentor: mentorCardOf(mentorOf.get(row.id)),
      })),
    };
  }

  // The sign-in page: nothing but what is public by nature (faction names, pitch, colour and art,
  // plus catalog counts) — no player data, no tuning values. Cached for a minute by the browser.
  @Public()
  @Get('public/landing')
  async landing(@Res({ passthrough: true }) response: Response): Promise<PublicLanding> {
    const [factions, art, parts, places] = await Promise.all([
      this.prisma.faction.findMany({ orderBy: { id: 'asc' } }),
      this.art.listUrls('factions'),
      this.prisma.partCatalog.count({ where: { active: true } }),
      this.prisma.location.count(),
    ]);
    response.set('Cache-Control', 'public, max-age=60');
    return {
      factions: factions.map((row) => ({
        id: row.id,
        displayName: row.displayName as PublicFaction['displayName'],
        description: row.description as PublicFaction['description'],
        color: row.color,
        playable: row.playable,
        art: art[row.id] ?? null,
      })),
      counts: { parts, places, factions: factions.length },
    };
  }

  @Get('places/art')
  async places(): Promise<{ places: Record<string, ArtUrls> }> {
    return { places: await this.art.listUrls('locations') };
  }

  // Public on purpose: the browser loads these as plain <img>/CSS backgrounds. File names are
  // validated against a strict pattern, hashed by content and served immutable; an SVG is sandboxed
  // by CSP so nothing inside it can run.
  @Public()
  @Get('art/:file')
  async file(@Param('file') file: string, @Res() response: Response): Promise<void> {
    const { bytes, mime } = await this.art.read(file);
    response
      .status(200)
      .set({
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'Cross-Origin-Resource-Policy': 'cross-origin',
      })
      .send(bytes);
  }
}
