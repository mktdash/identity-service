import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildApp } from "../src/app.ts";

const OUTPUT = "docs/openapi/identity-service.json";

const app = await buildApp();

try {
  const document = app.swagger();
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  const paths = Object.keys(
    (document as { paths?: Record<string, unknown> }).paths ?? {},
  );

  process.stdout.write(
    `\nOpenAPI snapshot written to ${OUTPUT}\n` +
      paths.map((path) => `  ${path}\n`).join("") +
      `\nReview the diff before committing.\n\n`,
  );
} finally {
  await app.close();
}

process.exit(0);
