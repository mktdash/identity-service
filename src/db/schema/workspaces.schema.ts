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
import { organizations } from "./organizations.schema.ts";

export const WORKSPACE_STATUSES = ["active", "archived"] as const;

export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status").notNull().$type<WorkspaceStatus>().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("workspaces_organization_slug_key")
      .on(table.organizationId, table.slug)
      .where(sql`deleted_at is null`),
    index("workspaces_organization_id_idx").on(table.organizationId),
    index("workspaces_organization_created_at_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    check(
      "workspaces_status_check",
      sql`${table.status} in ('active', 'archived')`,
    ),
  ],
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
