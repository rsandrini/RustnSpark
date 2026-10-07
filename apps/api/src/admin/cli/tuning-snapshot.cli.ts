import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { AppModule } from '../../app.module.js';
import { BundleService } from '../tuning/bundle.service.js';
import { CONFIG_REGISTRY } from '../../config/config-registry.js';
import {
  buildEntityValidator,
  getEntityNames,
  getEntitySchema,
} from '../tuning/entity-schemas.js';
import { EntityTuningService, getIdField } from '../tuning/entity-tuning.service.js';
import {
  buildTuningSnapshot,
  importTuningSnapshot,
  type TuningSnapshot,
} from '../tuning/tuning-snapshot.js';

const ACTOR = 'tuning-snapshot-cli';
const REASON = 'tuning snapshot import';

// Saves every value the Admin can tune (GameConfig + all entity tables) to one JSON file, so a
// DB reset doesn't lose them. Read-only. Run it inside the api container and copy the file out:
//   docker compose exec -T api node dist/admin/cli/tuning-snapshot.cli.js --export /tmp/tuning.json
//   docker compose cp api:/tmp/tuning.json ./tuning-snapshot.json
// Re-apply after a DB reset (migrate + seed first; snapshot values then win over seed defaults).
// Dry run unless --apply is given; exits 1 if any row fails:
//   docker compose cp ./tuning-snapshot.json api:/tmp/tuning.json
//   docker compose exec -T api node dist/admin/cli/tuning-snapshot.cli.js --import /tmp/tuning.json [--apply]
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      export: { type: 'string' },
      import: { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  if (!values.export && !values.import) {
    throw new Error('--export <file> or --import <file> is required');
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const entities = app.get(EntityTuningService);
    const bundle = app.get(BundleService);
    if (values.import) {
      const snapshot = JSON.parse(await readFile(values.import, 'utf8')) as TuningSnapshot;
      const report = await importTuningSnapshot(
        {
          fieldNames: (entity) => getEntitySchema(entity)?.fields.map((field) => field.name),
          idField: getIdField,
          validate: (entity, mode, row) => {
            const schema = getEntitySchema(entity);
            if (!schema) return 'unknown entity';
            const result = buildEntityValidator(schema, mode).safeParse(row);
            return result.success
              ? null
              : result.error.issues
                  .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                  .join('; ');
          },
          listEntity: (entity) => entities.list(entity),
          createEntity: (entity, row) => entities.create(entity, row, ACTOR, REASON),
          updateEntity: (entity, id, row) => entities.update(entity, id, row, ACTOR, REASON),
          configKeys: () => CONFIG_REGISTRY.map((entry) => entry.key),
          currentConfig: async () =>
            Object.fromEntries((await bundle.export()).entries.map((e) => [e.key, e.value])),
          importConfig: (entries) => bundle.import(entries, ACTOR),
        },
        snapshot,
        { apply: values.apply },
      );
      console.log(JSON.stringify(report, null, 2));
      if (Object.values(report.entities).some((entity) => entity.failed.length > 0)) {
        process.exitCode = 1;
      }
      return;
    }
    const exportPath = values.export!;
    const snapshot = await buildTuningSnapshot({
      entityNames: getEntityNames,
      listEntity: (entity) => entities.list(entity),
      exportConfig: () => bundle.export(),
      now: () => new Date(),
    });
    await writeFile(exportPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    const counts = Object.fromEntries(
      Object.entries(snapshot.entities).map(([name, rows]) => [name, rows.length]),
    );
    console.log(
      JSON.stringify({ file: exportPath, configKeys: snapshot.config.entries.length, counts }),
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
