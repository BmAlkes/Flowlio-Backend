import { database, migrateSchema } from "@/configs/connection.config";
import { logger } from "./logger.util";

/**
 * @param enableMigration
 * Make sure to pass true before pushing it to production.
 */

export const prepareMigration = async (enableMigration = false) => {
  if (!enableMigration) return null;
  try {
    await migrateSchema(database);
    logger.info("migration successful.");
  } catch (e) {
    const error = e as Error;
    logger.error(`migration failure: ${error.message}`);
    logger.warn('make sure to run the command "npm run dbgenerate".');
  }
};
