/**
 * Seed script — inserts default data into the database.
 *
 * Admin user uses a placeholder clerkId. Once Clerk is configured, update
 * ADMIN_CLERK_ID to the real Clerk user ID so the account is linked properly.
 *
 * Run with: pnpm --filter @workspace/db run seed
 */

import { db, pool } from "./index";
import { usersTable } from "./schema/users";
import { eq } from "drizzle-orm";

// Replace this with the real Clerk user ID after Clerk is configured.
const ADMIN_CLERK_ID = "seed_admin_placeholder";

async function seed() {
  console.log("🌱 Seeding database...");

  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkId, ADMIN_CLERK_ID));

  if (existing.length > 0) {
    console.log("✅ Admin user already exists, skipping.");
  } else {
    await db.insert(usersTable).values({
      clerkId: ADMIN_CLERK_ID,
      email: "admin@radarbet.local",
      name: "Admin",
      role: "admin",
      activeSubscription: true,
    });
    console.log("✅ Admin user created (clerkId: seed_admin_placeholder).");
    console.log(
      "   → After configuring Clerk, update ADMIN_CLERK_ID in lib/db/src/seed.ts",
      "to the real Clerk user ID and re-run the seed.",
    );
  }

  await pool.end();
  console.log("🌱 Done.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
