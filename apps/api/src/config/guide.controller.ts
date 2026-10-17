import { Controller, Get } from '@nestjs/common';
import { GameConfigService } from './game-config.service.js';

/** One thing an upgrade asks for besides money (see `economy.upgrade_materials`). */
export interface GuideUpgradeMaterial {
  readonly material: string;
  readonly mode: string;
  readonly k: number;
}

/** The player-facing figures the in-game Guide quotes, so its texts never go stale when the admin retunes. */
export interface GuideRulesResponse {
  readonly fuelPrice: number;
  readonly chemLevelMax: number;
  readonly ionLevelMax: number;
  readonly repairScrapMax: number;
  readonly repairPointsPerScrap: number;
  readonly repairSecondsPerPoint: Readonly<Record<string, number>>;
  readonly sellRatio: number;
  readonly startCredits: number;
  readonly rescueCost: number;
  readonly upgradePriceMultiplier: Readonly<Record<string, number>>;
  readonly upgradeMaterials: Readonly<Record<string, readonly GuideUpgradeMaterial[]>>;
  readonly scavengeCooldownSeconds: number;
  readonly scavengeShipSeconds: number;
  readonly scavengeFootSeconds: number;
  readonly miningJobSeconds: number;
  readonly shieldRegen: number;
  readonly armorPoolFactor: number;
  readonly armorReduction: number;
  readonly sparePartSlots: number;
  readonly openCargoUnitPay: number;
  readonly shipTierThresholds: Readonly<Record<string, number>>;
}

@Controller('guide')
export class GuideController {
  constructor(private readonly config: GameConfigService) {}

  @Get('rules')
  rules(): GuideRulesResponse {
    const { economy, engine, scavenging, mining, combat, ship, missions } =
      this.config.snapshot().rules;
    return {
      fuelPrice: economy.fuel_price,
      chemLevelMax: engine.chem_level_max,
      ionLevelMax: engine.ion_level_max,
      repairScrapMax: economy.repair_scrap_max,
      repairPointsPerScrap: economy.repair_points_per_scrap,
      repairSecondsPerPoint: { ...economy.repair_seconds_per_point },
      sellRatio: economy.sell_ratio,
      startCredits: economy.start_credits,
      rescueCost: economy.rescue_cost,
      upgradePriceMultiplier: { ...economy.part_upgrade_price_multiplier },
      upgradeMaterials: Object.fromEntries(
        Object.entries(economy.upgrade_materials).map(([rarity, needs]) => [
          rarity,
          needs.map((need) => ({ material: need.material, mode: need.mode, k: need.k })),
        ]),
      ),
      scavengeCooldownSeconds: scavenging.cooldown_seconds,
      scavengeShipSeconds: scavenging.duration_seconds,
      scavengeFootSeconds: scavenging.foot_duration_seconds,
      miningJobSeconds: mining.job_duration_seconds,
      shieldRegen: combat.shield_regen,
      armorPoolFactor: combat.armor_pool_factor,
      armorReduction: combat.armor_reduction,
      sparePartSlots: ship.spare_part_slots,
      openCargoUnitPay: missions.open_cargo_unit_pay,
      shipTierThresholds: Object.fromEntries(
        Object.entries(economy.ship_tier_thresholds).map(([tier, value]) => [tier, value]),
      ),
    };
  }
}
