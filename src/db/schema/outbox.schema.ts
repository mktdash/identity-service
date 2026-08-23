import { sql } from "drizzle-orm";
import {
  check,
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    eventType: text("event_type").notNull(),
    actorType: text("actor_type").notNull(),
    actorUserId: uuid("actor_user_id"),
    realActorUserId: uuid("real_actor_user_id"),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id"),
    organizationId: uuid("organization_id"),
    workspaceId: uuid("workspace_id"),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    index("outbox_unpublished_idx")
      .on(table.occurredAt)
      .where(sql`published_at is null`),
    index("outbox_organization_occurred_idx").on(
      table.organizationId,
      table.occurredAt,
    ),
    index("outbox_subject_idx").on(table.subjectType, table.subjectId),
    check(
      "outbox_actor_type_check",
      sql`${table.actorType} in ('user', 'system', 'service')`,
    ),
  ],
);

export type OutboxEvent = typeof outbox.$inferSelect;
export type NewOutboxEvent = typeof outbox.$inferInsert;
