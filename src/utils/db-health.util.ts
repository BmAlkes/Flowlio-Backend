import { connection } from "@/configs/connection.config";
import { logger } from "./logger.util";

export const testDatabaseConnection = async () => {
  try {
    const client = await connection.connect();

    // Test basic query
    const result = await client.query(
      "SELECT NOW() as current_time, version() as pg_version"
    );

    logger.info("Database connection successful", {
      currentTime: result.rows[0].current_time,
      pgVersion: result.rows[0].pg_version,
    });

    client.release();
    return { success: true, data: result.rows[0] };
  } catch (error) {
    logger.error("Database connection failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const getConnectionInfo = () => {
  const connectionString = process.env.CONNECTION_URL;
  if (!connectionString) {
    return { error: "CONNECTION_URL not found" };
  }

  try {
    const url = new URL(connectionString);
    return {
      host: url.hostname,
      port: url.port,
      database: url.pathname.slice(1), // Remove leading slash
      user: url.username,
      hasPassword: !!url.password,
      protocol: url.protocol,
      searchParams: Object.fromEntries(url.searchParams.entries()),
    };
  } catch (error) {
    return {
      error: `Failed to parse connection string: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
};

export const checkConnectionPool = () => {
  return {
    totalCount: connection.totalCount,
    idleCount: connection.idleCount,
    waitingCount: connection.waitingCount,
  };
};
