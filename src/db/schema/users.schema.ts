import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const USER_STATUSES = ["active", "suspended", "deactivated"] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

export const users = pgTable(
  "users",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    fullName: text("full_name").notNull(),
    status: text("status").notNull().$type<UserStatus>().default("active"),
    emailVerifiedAt: timestamp("email_verified_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastLoginAt: timestamp("last_login_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("users_email_normalized_key").on(table.emailNormalized),
    index("users_created_at_idx").on(table.createdAt),
    check(
      "users_status_check",
      sql`${table.status} in ('active', 'suspended', 'deactivated')`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
