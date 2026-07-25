import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userConfigsTable = pgTable("user_configs", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  geminiKeyEncrypted: text("gemini_key_encrypted"),
  geminiModel: text("gemini_model").default("gemini-2.0-flash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserConfigSchema = createInsertSchema(userConfigsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUserConfig = z.infer<typeof insertUserConfigSchema>;
export type UserConfig = typeof userConfigsTable.$inferSelect;
