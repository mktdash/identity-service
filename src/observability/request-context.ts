import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { trace } from "@opentelemetry/api";

export type RequestPrincipal = {
  userId?: string | undefined;
  organizationId?: string | undefined;
  workspaceId?: string | undefined;
  sessionId?: string | undefined;
};

export type RequestContext = RequestPrincipal & {
  readonly requestId: string;
  readonly traceId?: string | undefined;
  readonly spanId?: string | undefined;
};

const storage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function runWithRequestContext<T>(
  context: RequestContext,
  callback: () => T,
): T {
  return storage.run(context, callback);
}

export function setRequestPrincipal(principal: RequestPrincipal): void {
  const context = storage.getStore();
  if (context === undefined) {
    return;
  }

  for (const [key, value] of Object.entries(principal)) {
    if (typeof value === "string" && value.length > 0) {
      context[key as keyof RequestPrincipal] = value;
    }
  }
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/u;

export const REQUEST_ID_HEADER = "x-request-id";

export function normalizeRequestId(value: unknown): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") {
    return undefined;
  }

  const trimmed = candidate.trim();
  return REQUEST_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

export function createRequestId(): string {
  return randomUUID();
}

const TRACEPARENT_PATTERN =
  /^(?<version>[0-9a-f]{2})-(?<traceId>[0-9a-f]{32})-(?<spanId>[0-9a-f]{16})-(?<flags>[0-9a-f]{2})$/u;

export type TraceParent = {
  readonly traceId: string;
  readonly spanId: string;
};

export function parseTraceparent(value: unknown): TraceParent | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") {
    return undefined;
  }

  const groups = TRACEPARENT_PATTERN.exec(candidate.trim())?.groups;
  if (groups === undefined) {
    return undefined;
  }

  const traceId = groups["traceId"] ?? "";
  const spanId = groups["spanId"] ?? "";

  if (/^0+$/u.test(traceId) || /^0+$/u.test(spanId)) {
    return undefined;
  }

  return { traceId, spanId };
}

function traceFields(context: RequestContext | undefined): {
  trace_id?: string;
  span_id?: string;
} {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (spanContext !== undefined) {
    return { trace_id: spanContext.traceId, span_id: spanContext.spanId };
  }

  const result: { trace_id?: string; span_id?: string } = {};
  if (context?.traceId !== undefined) {
    result.trace_id = context.traceId;
  }
  if (context?.spanId !== undefined) {
    result.span_id = context.spanId;
  }

  return result;
}

export function logCorrelation(): Record<string, string> {
  const context = getRequestContext();
  const fields: Record<string, string> = { ...traceFields(context) };

  if (context === undefined) {
    return fields;
  }

  fields["requestId"] = context.requestId;

  for (const key of [
    "userId",
    "organizationId",
    "workspaceId",
    "sessionId",
  ] as const) {
    const value = context[key];
    if (value !== undefined) {
      fields[key] = value;
    }
  }

  return fields;
}
