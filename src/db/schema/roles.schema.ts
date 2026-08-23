import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations.schema.ts";

export const roles = pgTable(
  "roles",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    isPreset: boolean("is_preset").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("roles_preset_slug_key")
      .on(table.slug)
      .where(sql`organization_id is null`),
    uniqueIndex("roles_organization_slug_key")
      .on(table.organizationId, table.slug)
      .where(sql`organization_id is not null`),
    index("roles_organization_id_idx").on(table.organizationId),
    check(
      "roles_preset_has_no_organization_check",
      sql`(${table.isPreset} and ${table.organizationId} is null)
          or (not ${table.isPreset} and ${table.organizationId} is not null)`,
    ),
  ],
);

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
