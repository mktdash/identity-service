import { createHash } from "node:crypto";
import { logger } from "#observability/logger";

const log = logger.child({ component: "breached-password" });

const LOCAL_BREACH_LIST: ReadonlySet<string> = new Set([
  "password",
  "password1",
  "password123",
  "password1234",
  "passw0rd123",
  "12345678",
  "123456789",
  "1234567890",
  "123456789012",
  "qwertyuiop",
  "qwerty123456",
  "letmein123",
  "welcome123",
  "welcome1234",
  "admin123456",
  "administrator",
  "iloveyou123",
  "trustno1234",
  "monkey123456",
  "dragon123456",
  "follow axis",
  "followaxis",
  "followaxis123",
  "mktdash123456",
  "changeme1234",
  "letmein12345",
  "abcd12345678",
  "aaaaaaaaaaaa",
]);

export function isLocallyKnownBreached(password: string): boolean {
  return LOCAL_BREACH_LIST.has(password.trim().toLowerCase());
}

const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range";
const HIBP_TIMEOUT_MS = 1_500;

export type BreachCheckResult =
  | {
      readonly breached: true;
      readonly source: "local" | "hibp";
      readonly count?: number;
    }
  | { readonly breached: false; readonly unavailable?: boolean };

async function checkHibp(password: string): Promise<BreachCheckResult> {
  const sha1 = createHash("sha1")
    .update(password, "utf8")
    .digest("hex")
    .toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const response = await fetch(`${HIBP_RANGE_URL}/${prefix}`, {
    headers: {
      "Add-Padding": "true",
      "User-Agent": "mktdash-identity-service",
    },
    signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HIBP responded ${response.status}`);
  }

  for (const line of (await response.text()).split("\n")) {
    const [candidate, rawCount] = line.trim().split(":");

    if (candidate === suffix) {
      const count = Number(rawCount ?? 0);
      if (count > 0) {
        return { breached: true, source: "hibp", count };
      }
    }
  }

  return { breached: false };
}

export async function isBreachedPassword(
  password: string,
): Promise<BreachCheckResult> {
  if (isLocallyKnownBreached(password)) {
    return { breached: true, source: "local" };
  }

  try {
    return await checkHibp(password);
  } catch (error) {
    log.warn(
      { err: error, event: "breach_check_unavailable" },
      "HIBP unreachable — falling back to the local breach list only",
    );

    return { breached: false, unavailable: true };
  }
}
