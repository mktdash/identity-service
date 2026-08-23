import {
  ACTOR_TYPES,
  type ActorType,
  type AuditEventType,
} from "#config/constants";
import { outbox } from "#db/schema/outbox.schema";
import type { Transaction } from "#db/tenant";

export type AuditActor = {
  readonly type: ActorType;
  readonly userId?: string | undefined;
  readonly realUserId?: string | undefined;
};

export type AuditSubject = {
  readonly type: string;
  readonly id?: string | undefined;
};

export type AuditRequestMetadata = {
  readonly ipAddress?: string | undefined;
  readonly userAgent?: string | undefined;
  readonly requestId?: string | undefined;
};

export type AuditEvent = {
  readonly type: AuditEventType;
  readonly actor: AuditActor;
  readonly subject: AuditSubject;
  readonly organizationId?: string | undefined;
  readonly workspaceId?: string | undefined;
  readonly request?: AuditRequestMetadata | undefined;
  readonly before?: Readonly<Record<string, unknown>> | undefined;
  readonly after?: Readonly<Record<string, unknown>> | undefined;
};

export async function emitAuditEvent(
  tx: Transaction,
  event: AuditEvent,
): Promise<void> {
  await tx.insert(outbox).values({
    eventType: event.type,
    actorType: event.actor.type,
    actorUserId: event.actor.userId ?? null,
    realActorUserId: event.actor.realUserId ?? null,
    subjectType: event.subject.type,
    subjectId: event.subject.id ?? null,
    organizationId: event.organizationId ?? null,
    workspaceId: event.workspaceId ?? null,
    ipAddress: event.request?.ipAddress ?? null,
    userAgent: event.request?.userAgent ?? null,
    requestId: event.request?.requestId ?? null,
    before: event.before ?? null,
    after: event.after ?? null,
  });
}

export const SYSTEM_ACTOR: AuditActor = { type: ACTOR_TYPES.system };
