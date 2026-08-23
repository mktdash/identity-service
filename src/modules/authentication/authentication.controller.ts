import type { FastifyReply, FastifyRequest } from "fastify";
import { setRequestPrincipal } from "#observability/request-context";
import type {
  RegisterBody,
  RegisterResponse,
  ResendVerificationBody,
  ResendVerificationResponse,
  VerifyEmailBody,
  VerifyEmailResponse,
} from "./authentication.dto.ts";
import { authenticationService } from "./authentication.service.ts";

function requestMetadata(request: FastifyRequest) {
  return {
    requestId: request.ctx.requestId,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"],
  };
}

export async function register(
  request: FastifyRequest<{ Body: RegisterBody }>,
  reply: FastifyReply,
): Promise<void> {
  const result: RegisterResponse = await authenticationService.register({
    fullName: request.body.fullName,
    email: request.body.email,
    password: request.body.password,
    workspaceName: request.body.workspaceName,
    tenancy: request.body.tenancy,
    request: requestMetadata(request),
  });

  request.log.info(
    { event: "registration_started", tenancy: request.body.tenancy },
    "self-serve registration pending email verification",
  );

  await reply.code(202).send(result);
}

export async function verifyEmail(
  request: FastifyRequest<{ Body: VerifyEmailBody }>,
  reply: FastifyReply,
): Promise<void> {
  const result: VerifyEmailResponse = await authenticationService.verifyEmail({
    email: request.body.email,
    code: request.body.code,
    request: requestMetadata(request),
  });

  setRequestPrincipal({
    userId: result.user.id,
    organizationId: result.organization.id,
    workspaceId: result.workspace.id,
  });

  request.log.info(
    {
      event: "email_verified",
      userId: result.user.id,
      organizationId: result.organization.id,
      workspaceId: result.workspace.id,
    },
    "email verified — session established",
  );

  await reply.code(200).send(result);
}

export async function resendVerification(
  request: FastifyRequest<{ Body: ResendVerificationBody }>,
  reply: FastifyReply,
): Promise<void> {
  const result: ResendVerificationResponse =
    await authenticationService.resendVerification({
      email: request.body.email,
      request: requestMetadata(request),
    });

  await reply.code(202).send(result);
}
