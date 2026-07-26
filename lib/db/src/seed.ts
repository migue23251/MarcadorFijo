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
import { subscriptionPlansTable } from "./schema/subscriptionPlans";
import { systemSettingsTable } from "./schema/systemSettings";
import { eq } from "drizzle-orm";

// Replace this with the real Clerk user ID after Clerk is configured.
const ADMIN_CLERK_ID = "seed_admin_placeholder";

async function seed() {
  console.log("🌱 Seeding database...");

  const plans = [
    { slug: "mensual", name: "Mensual", priceCop: 39900, billingInterval: "month", durationMonths: 1, discountPercent: 0 },
    { slug: "trimestral", name: "Trimestral", priceCop: 99900, billingInterval: "quarter", durationMonths: 3, discountPercent: 16 },
    { slug: "semestral", name: "Semestral", priceCop: 179900, billingInterval: "half-year", durationMonths: 6, discountPercent: 25 },
    { slug: "anual", name: "Anual", priceCop: 299900, billingInterval: "year", durationMonths: 12, discountPercent: 37 },
  ];

  for (const plan of plans) {
    await db
      .insert(subscriptionPlansTable)
      .values(plan)
      .onConflictDoUpdate({
        target: subscriptionPlansTable.slug,
        set: plan,
      });
  }
  await db
    .insert(systemSettingsTable)
    .values({ id: 1, freemiumEnabled: true })
    .onConflictDoNothing({ target: systemSettingsTable.id });
  console.log("✅ Subscription plans and freemium settings ready.");

  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkId, ADMIN_CLERK_ID));

  if (existing.length > 0) {
    if (
      existing[0].activeSubscription &&
      existing[0].subscriptionExpiresAt === null
    ) {
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      await db
        .update(usersTable)
        .set({
          subscriptionPlan: "anual",
          subscriptionExpiresAt: expiresAt,
          isSubscriptionActive: true,
        })
        .where(eq(usersTable.clerkId, ADMIN_CLERK_ID));
      console.log("✅ Legacy admin subscription normalized to annual.");
    }
    console.log("✅ Admin user already exists, skipping.");
  } else {
    await db.insert(usersTable).values({
      clerkId: ADMIN_CLERK_ID,
      email: "admin@radarbet.local",
      name: "Admin",
      role: "admin",
      activeSubscription: true,
      subscriptionPlan: "anual",
      subscriptionExpiresAt: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
      isSubscriptionActive: true,
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
