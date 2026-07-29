import { pgTable, serial, text, timestamp, doublePrecision, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const betsTable = pgTable("bets", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  league: text("league").notNull(),
  kickoffTime: text("kickoff_time").notNull(),
  market: text("market").notNull(),
  selection: text("selection").notNull(),
  odds: doublePrecision("odds").notNull(),
  stake: doublePrecision("stake").notNull(),
  fixtureId: integer("fixture_id"), // API-Football fixture ID for exact result matching
  confidence: text("confidence"), // "low" | "medium" | "high" — AI prediction confidence
  status: text("status").notNull().default("pending"), // "pending" | "won" | "lost" | "void"
  returnAmount: doublePrecision("return_amount"),
  finalScore: text("final_score"), // e.g. "2-1"
  finalStats: text("final_stats"), // JSON: {homeCorners,awayCorners,totalCorners,homeYellowCards,awayYellowCards,homeRedCards,awayRedCards,totalCards}
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBetSchema = createInsertSchema(betsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertBet = z.infer<typeof insertBetSchema>;
export type Bet = typeof betsTable.$inferSelect;
