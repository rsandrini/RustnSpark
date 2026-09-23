import { Injectable } from '@nestjs/common';
import { GameConfigValidationError } from '../../config/game-config.types.js';
import { PrismaService } from '../../prisma/prisma.service.js';

// Config values that point at catalog/world rows. The schema only checks their shape; this
// checks the rows they name exist (and, for parts, are active), so a bad Admin edit cannot
// silently break new-player onboarding.
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

  private async assertActiveParts(key: string, partTypes: string[]): Promise<void> {
    const unique = [...new Set(partTypes)];
    const rows = await this.prisma.partCatalog.findMany({
      where: { partType: { in: unique }, active: true },
      select: { partType: true },
    });
    const found = new Set(rows.map((row) => row.partType));
    const missing = unique.filter((partType) => !found.has(partType));
    if (missing.length > 0) {
      throw new GameConfigValidationError(`Starter parts must exist and be active: ${missing.join(', ')}`, [
        { key, message: 'STARTER_PART_NOT_ACTIVE', value: missing },
      ]);
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
