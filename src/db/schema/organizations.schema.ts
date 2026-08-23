import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { TenancyMode } from "#config/constants";

export const ORGANIZATION_STATUSES = ["active", "suspended"] as const;

export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status")
      .notNull()
      .$type<OrganizationStatus>()
      .default("active"),
    tenancy: text("tenancy").notNull().$type<TenancyMode>().default("company"),
    dataRetentionDays: integer("data_retention_days").notNull().default(365),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("organizations_slug_key").on(table.slug),
    index("organizations_created_at_idx").on(table.createdAt),
    check(
      "organizations_status_check",
      sql`${table.status} in ('active', 'suspended')`,
    ),
    check(
      "organizations_tenancy_check",
      sql`${table.tenancy} in ('company', 'agency')`,
    ),
    check(
      "organizations_retention_check",
      sql`${table.dataRetentionDays} between 1 and 3650`,
    ),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
