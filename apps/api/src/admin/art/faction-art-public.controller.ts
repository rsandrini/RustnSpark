import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { FactionArtService, type ArtUrls } from './faction-art.service.js';

/** What every signed-in player needs: which factions have uploaded images (the rest keep defaults). */
@Controller()
export class FactionArtPublicController {
  constructor(private readonly art: FactionArtService) {}

  @Get('factions/art')
  async list(): Promise<{ factions: Record<string, ArtUrls> }> {
    return { factions: await this.art.listUrls() };
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

