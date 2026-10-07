import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { AppModule } from '../../app.module.js';
import { BundleService } from '../tuning/bundle.service.js';
import { getEntityNames } from '../tuning/entity-schemas.js';
import { EntityTuningService } from '../tuning/entity-tuning.service.js';
import { buildTuningSnapshot } from '../tuning/tuning-snapshot.js';

// Saves every value the Admin can tune (GameConfig + all entity tables) to one JSON file, so a
// DB reset doesn't lose them. Read-only. Run it inside the api container and copy the file out:
//   docker compose exec -T api node dist/admin/cli/tuning-snapshot.cli.js --export /tmp/tuning.json
//   docker compose cp api:/tmp/tuning.json ./tuning-snapshot.json
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { export: { type: 'string' } },
    allowPositionals: false,
  });
  if (!values.export) {
    throw new Error('--export <file> is required');
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const entities = app.get(EntityTuningService);
    const bundle = app.get(BundleService);
    const snapshot = await buildTuningSnapshot({
      entityNames: getEntityNames,
      listEntity: (entity) => entities.list(entity),
      exportConfig: () => bundle.export(),
      now: () => new Date(),
    });
    await writeFile(values.export, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    const counts = Object.fromEntries(
      Object.entries(snapshot.entities).map(([name, rows]) => [name, rows.length]),
    );
    console.log(
      JSON.stringify({ file: values.export, configKeys: snapshot.config.entries.length, counts }),
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
