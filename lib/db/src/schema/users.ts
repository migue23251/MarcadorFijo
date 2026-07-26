import { pgTable, serial, text, boolean, timestamp, date, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email").notNull().default(""),
  name: text("name"),
  role: text("role").notNull().default("user"), // "user" | "admin"
  currency: text("currency").notNull().default("COP"),
  activeSubscription: boolean("active_subscription").notNull().default(false),
  subscriptionExpiresAt: timestamp("subscription_expires_at", { withTimezone: true }),
  subscriptionPlan: text("subscription_plan").notNull().default("free"),
  isSubscriptionActive: boolean("is_subscription_active").notNull().default(false),
  dailyFreeAnalysesUsed: integer("daily_free_analyses_used").notNull().default(0),
  lastAnalysisDate: date("last_analysis_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
