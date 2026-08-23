import { sql } from "drizzle-orm";
import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users.schema.ts";

export const credentials = pgTable(
  "credentials",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    passwordHash: text("password_hash").notNull(),
    passwordUpdatedAt: timestamp("password_updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),

    totpSecret: text("totp_secret"),
    totpEnrolledAt: timestamp("totp_enrolled_at", {
      withTimezone: true,
      mode: "date",
    }),

    emailVerificationTokenHash: text("email_verification_token_hash"),
    emailVerificationExpiresAt: timestamp("email_verification_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    emailVerificationConsumedAt: timestamp("email_verification_consumed_at", {
      withTimezone: true,
      mode: "date",
    }),

    emailVerificationAttempts: integer("email_verification_attempts")
      .notNull()
      .default(0),
    emailVerificationSentAt: timestamp("email_verification_sent_at", {
      withTimezone: true,
      mode: "date",
    }),

    passwordResetTokenHash: text("password_reset_token_hash"),
    passwordResetExpiresAt: timestamp("password_reset_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    passwordResetConsumedAt: timestamp("password_reset_consumed_at", {
      withTimezone: true,
      mode: "date",
    }),

    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("credentials_user_id_key").on(table.userId),
    uniqueIndex("credentials_email_verification_token_key")
      .on(table.emailVerificationTokenHash)
      .where(sql`email_verification_token_hash is not null`),
    uniqueIndex("credentials_password_reset_token_key")
      .on(table.passwordResetTokenHash)
      .where(sql`password_reset_token_hash is not null`),
  ],
);

export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;
