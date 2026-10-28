import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module.js';
import { ShipRatingService } from '../../stats/ship-rating.service.js';

// Rates every pilot's ship for the power and speed ranking boards. A one-off load for now; a
// scheduled job will call ShipRatingService.refreshAll() the same way later.
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const rated = await app.get(ShipRatingService).refreshAll();
    console.log(`rated ${rated} ship${rated === 1 ? '' : 's'}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
