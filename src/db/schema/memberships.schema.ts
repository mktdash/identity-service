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
import { organizations } from "./organizations.schema.ts";
import { roles } from "./roles.schema.ts";
import { users } from "./users.schema.ts";
import { workspaces } from "./workspaces.schema.ts";

export const MEMBERSHIP_STATUSES = ["active", "suspended"] as const;

export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    dataScope: text("data_scope").notNull().default("workspace"),
    status: text("status")
      .notNull()
      .$type<MembershipStatus>()
      .default("active"),
    permissionVersion: integer("permission_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("memberships_user_workspace_key").on(
      table.userId,
      table.workspaceId,
    ),
    index("memberships_workspace_id_idx").on(table.workspaceId),
    index("memberships_organization_id_idx").on(table.organizationId),
    index("memberships_user_id_idx").on(table.userId),
    index("memberships_role_id_idx").on(table.roleId),
    check(
      "memberships_status_check",
      sql`${table.status} in ('active', 'suspended')`,
    ),
    check(
      "memberships_data_scope_check",
      sql`${table.dataScope} in ('own', 'team', 'workspace', 'organization')`,
    ),
  ],
);

export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
