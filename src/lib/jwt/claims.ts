import { TOKEN_TYPES, type TokenType } from "#config/constants";

export type AccessTokenClaims = {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly jti: string;
  readonly iat: number;
  readonly exp: number;
  readonly typ: TokenType;
  readonly sid: string;
  readonly org: string;
  readonly ws?: string;
  readonly pv: number;
  readonly act?: { readonly sub: string };
};

export type AccessTokenInput = {
  readonly userId: string;
  readonly sessionId: string;
  readonly organizationId: string;
  readonly workspaceId?: string | undefined;
  readonly permissionVersion: number;
  readonly actorUserId?: string | undefined;
};

export function isAccessToken(claims: { typ?: unknown }): boolean {
  return claims.typ === TOKEN_TYPES.access;
}
