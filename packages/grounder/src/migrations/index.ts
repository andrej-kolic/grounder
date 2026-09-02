import { retireLegacyCommands } from "./004-retire-legacy-commands.js";
import type { Migration, MigrationArtifactResult, MigrationContext } from "./types.js";

export type {
  LegacyRetireStatus,
  Migration,
  MigrationArtifactResult,
  MigrationContext,
} from "./types.js";

/**
 * Every registered migration, explicit and ordered — no filesystem/glob
 * discovery (fragile under the bundled/pkg CLI build).
 */
export const MIGRATIONS: readonly Migration[] = [retireLegacyCommands];

/**
 * Runs every registered migration unconditionally, every `grounder migrate`
 * call. Not schema-gated — see `docs/architecture/migrations.md`.
 */
export async function runMigrations(ctx: MigrationContext): Promise<MigrationArtifactResult[]> {
  const results: MigrationArtifactResult[] = [];
  for (const migration of MIGRATIONS) {
    results.push(...(await migration.run(ctx)));
  }
  return results;
}
