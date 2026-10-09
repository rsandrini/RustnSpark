import { Injectable } from '@nestjs/common';
import { GameConfigValidationError, type GameRules } from '../../config/game-config.types.js';
import { worstCaseRestartKitValue } from '../../economy/restart-kit.value.js';
import { PrismaService } from '../../prisma/prisma.service.js';

// Config values that point at catalog/world rows. The schema only checks their shape; this
// checks the rows they name exist (and, for parts, are active), so a bad Admin edit cannot
// silently break new-player onboarding. It also enforces the cross-key economy invariant:
// the free restart kit must always sell for strictly less than rescue_cost, or
// rescue → kit → sell prints credits (S8.6).
@Injectable()
export class ConfigReferenceValidator {
  constructor(private readonly prisma: PrismaService) {}

  async assertReferences(key: string, value: unknown): Promise<void> {
    if (key === 'onboarding.starter_parts') {
      await this.assertActiveParts(key, value as string[]);
    }
    if (key === 'onboarding.home_locations') {
      await this.assertLocations(key, Object.values(value as Record<string, string>));
    }
  }

  // `key` is the config key under change, used as the issue's key so the admin UI points
  // at what the caller was editing when the invariant broke (the offender may be any of
  // restart_condition_max, rescue_cost, sell_ratio, the multipliers, or starter_parts).
  async assertRestartKitEconomy(rules: GameRules, key: string): Promise<void> {
    const partTypes = [...new Set(rules.onboarding.starter_parts as string[])];
    const rows = await this.prisma.partCatalog.findMany({
      where: { partType: { in: partTypes } },
      select: { partType: true, basePrice: true },
    });
    const basePrices = new Map(rows.map((row) => [row.partType, row.basePrice]));
    // A starter part absent from the catalog is priced at 0 — the kit it cannot include
    // is worth less, so the computed value stays a valid upper bound (and building the
    // kit at all is separately guaranteed by assertActiveParts when starter_parts is
    // edited). This keeps unrelated config edits from failing on a catalog row.
    const value = worstCaseRestartKitValue(rules, (partType) => basePrices.get(partType) ?? 0);
    // The cheapest way out is waiting for the rescue: that is the price the kit must stay under.
    const cheapestRescue = Math.round(rules.economy.rescue_cost * rules.economy.rescue_wait_fraction);
    if (value >= cheapestRescue) {
      throw new GameConfigValidationError(
        `Restart kit would sell for ${value}¢, not strictly less than the cheapest rescue ${cheapestRescue}¢`,
        [{ key, message: 'RESTART_KIT_NOT_WORTH_LESS_THAN_RESCUE', value }],
      );
    }
  }

  private async assertActiveParts(key: string, partTypes: string[]): Promise<void> {
    const unique = [...new Set(partTypes)];
    const rows = await this.prisma.partCatalog.findMany({
      where: { partType: { in: unique }, active: true },
      select: { partType: true },
    });
    const found = new Set(rows.map((row) => row.partType));
    const missing = unique.filter((partType) => !found.has(partType));
    if (missing.length > 0) {
      throw new GameConfigValidationError(
        `Starter parts must exist and be active: ${missing.join(', ')}`,
        [{ key, message: 'STARTER_PART_NOT_ACTIVE', value: missing }],
      );
    }
  }

  private async assertLocations(key: string, locationIds: string[]): Promise<void> {
    const unique = [...new Set(locationIds)];
    const rows = await this.prisma.location.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    });
    const found = new Set(rows.map((row) => row.id));
    const missing = unique.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new GameConfigValidationError(`Home locations must exist: ${missing.join(', ')}`, [
        { key, message: 'HOME_LOCATION_NOT_FOUND', value: missing },
      ]);
    }
  }
}
