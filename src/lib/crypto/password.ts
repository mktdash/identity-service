import { hash, verify, type Options } from "@node-rs/argon2";
import { ARGON2_PARAMS } from "#config/constants";

const ARGON2ID = 2 as NonNullable<Options["algorithm"]>;

const HASH_OPTIONS: Options = {
  algorithm: ARGON2ID,
  memoryCost: ARGON2_PARAMS.memoryCost,
  timeCost: ARGON2_PARAMS.timeCost,
  parallelism: ARGON2_PARAMS.parallelism,
  outputLen: ARGON2_PARAMS.outputLen,
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, HASH_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHashPromise: Promise<string> | undefined;

function dummyHash(): Promise<string> {
  dummyHashPromise ??= hash(
    "argon2-timing-equalizer-not-a-real-password",
    HASH_OPTIONS,
  );
  return dummyHashPromise;
}

export async function verifyPasswordDummy(): Promise<void> {
  await verify(await dummyHash(), "definitely-not-the-password").catch(
    () => false,
  );
}

const ENCODED_PARAMS =
  /^\$argon2(?<variant>id|i|d)\$v=(?<version>\d+)\$m=(?<memory>\d+),t=(?<time>\d+),p=(?<parallelism>\d+)\$/u;

export function passwordNeedsRehash(passwordHash: string): boolean {
  const groups = ENCODED_PARAMS.exec(passwordHash)?.groups;
  if (groups === undefined) {
    return true;
  }

  if (groups["variant"] !== "id") {
    return true;
  }

  return (
    Number(groups["memory"]) < ARGON2_PARAMS.memoryCost ||
    Number(groups["time"]) < ARGON2_PARAMS.timeCost ||
    Number(groups["parallelism"]) !== ARGON2_PARAMS.parallelism
  );
}
