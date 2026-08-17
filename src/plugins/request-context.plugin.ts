import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import {
  createRequestId,
  getRequestContext,
  normalizeRequestId,
  parseTraceparent,
  REQUEST_ID_HEADER,
  runWithRequestContext,
  type RequestContext,
} from "#observability/request-context";

export function genReqId(request: {
  headers: Record<string, unknown>;
}): string {
  return (
    normalizeRequestId(request.headers[REQUEST_ID_HEADER]) ?? createRequestId()
  );
}

function buildContext(request: FastifyRequest): RequestContext {
  const requestId =
    normalizeRequestId(request.headers[REQUEST_ID_HEADER]) ??
    normalizeRequestId(request.id) ??
    createRequestId();

  const traceparent = parseTraceparent(request.headers["traceparent"]);

  return traceparent === undefined
    ? { requestId }
    : {
        requestId,
        traceId: traceparent.traceId,
        spanId: traceparent.spanId,
      };
}

async function requestContextPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest("ctx", {
    getter(this: FastifyRequest): RequestContext {
      const context = getRequestContext();
      if (context === undefined) {
        throw new Error(
          "request.ctx read outside the request-context scope — register request-context.plugin.ts before this hook",
        );
      }

      return context;
    },
  });

  app.addHook("onRequest", (request, reply, done) => {
    const context = buildContext(request);
    void reply.header(REQUEST_ID_HEADER, context.requestId);
    runWithRequestContext(context, done);
  });
}

export default fp(requestContextPlugin, {
  name: "request-context",
  fastify: "5.x",
});
