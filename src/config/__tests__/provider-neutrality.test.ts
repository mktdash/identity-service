import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MAIL_PATH = ["src/config/smtp.ts", "src/config/env.ts", "src/lib/mail"];
const PROVIDER_MARKERS = [
  "gmail",
  "googlemail",
  "smtp.google",
  "postmarkapp",
  "mailgun",
  "sendgrid",
  "amazonaws",
  "mailpit",
  "mailhog",
  "sparkpost",
  "resend.com",
  "mandrill",
] as const;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        return entry.name === "__tests__" ? [] : sourceFiles(path);
      }

      return entry.name.endsWith(".ts") ? [path] : [];
    }),
  );

  return nested.flat();
}

export function stripComments(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//gu, " ")
    .replaceAll(/(^|[^:])\/\/[^\n]*/gu, "$1");
}

async function mailPathFiles(): Promise<string[]> {
  const groups = await Promise.all(
    MAIL_PATH.map(async (entry) =>
      entry.endsWith(".ts") ? [entry] : sourceFiles(entry),
    ),
  );

  return groups.flat();
}

describe("the mail path is provider-independent", () => {
  it("special-cases no mail provider in executable code", async () => {
    const files = await mailPathFiles();
    expect(files.length).toBeGreaterThan(3);

    const offenders: string[] = [];

    for (const file of files) {
      const code = stripComments(await readFile(file, "utf8")).toLowerCase();

      for (const marker of PROVIDER_MARKERS) {
        if (code.includes(marker)) {
          offenders.push(`${file}: ${marker}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("still catches a provider hostname hidden in a string literal", () => {
    const code = stripComments(
      'const host = "https://smtp.gmail.com"; // a comment naming mailgun\n',
    ).toLowerCase();

    expect(code).toContain("smtp.gmail.com");
    expect(code).not.toContain("mailgun");
  });
});
