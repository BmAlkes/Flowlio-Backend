/**
 * One-time script to fix existing demo account users
 * Sets all users in demo organizations to "active" status
 * Run with: npx ts-node -r tsconfig-paths/register scripts/fix-demo-account-status.ts
 */

import { database } from "../src/configs/connection.config";
import { users, organizations, userOrganizations } from "../src/schema/schema";
import { eq, inArray } from "drizzle-orm";
import { logger } from "../src/utils/logger.util";

async function fixDemoAccountStatus() {
  try {
    logger.info("🔧 Starting demo account status fix...");

    // Get all organizations and filter for demo ones
    const allOrgs = await database.query.organizations.findMany({
      where: eq(organizations.status, "active"),
      columns: {
        id: true,
        settings: true,
      },
    });

    const demoOrgIds = allOrgs
      .filter((org) => {
        const settings = org.settings as any;
        return settings?.demo === true;
      })
      .map((org) => org.id);

    logger.info(`Found ${demoOrgIds.length} demo organizations`);

    if (demoOrgIds.length === 0) {
      logger.info("No demo organizations found. Nothing to update.");
      return;
    }

    // Get all users in demo organizations using inArray
    const usersInDemoOrgs = await database
      .select({
        userId: userOrganizations.userId,
      })
      .from(userOrganizations)
      .where(inArray(userOrganizations.organizationId, demoOrgIds));

    // Remove duplicates
    const uniqueUserIds = [...new Set(usersInDemoOrgs.map((u) => u.userId))];

    logger.info(`Found ${uniqueUserIds.length} users in demo organizations`);

    if (uniqueUserIds.length === 0) {
      logger.info("No users found in demo organizations. Nothing to update.");
      return;
    }

    // Update all users' status to "active" in one query
    const updateResult = await database
      .update(users)
      .set({ status: "active" })
      .where(inArray(users.id, uniqueUserIds));

    logger.info(
      `✅ Updated ${uniqueUserIds.length} demo account users to "active" status`
    );

    console.log("\n✅ Demo account status fix completed successfully!");
    console.log(
      `   - Updated ${uniqueUserIds.length} users in ${demoOrgIds.length} demo organizations`
    );
  } catch (error) {
    logger.error("Error fixing demo account status:", error);
    console.error("❌ Error:", error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Run the script
fixDemoAccountStatus();
