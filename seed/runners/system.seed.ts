import { isNull, sql } from "drizzle-orm";
import { roles } from "#db/schema/roles.schema";
import { ROLE_PRESETS } from "../data/role-presets.ts";
import { openSeedConnection } from "../lib/connection.ts";

const connection = openSeedConnection();

try {
  const inserted = await connection.db
    .insert(roles)
    .values(
      ROLE_PRESETS.map((preset) => ({
        organizationId: null,
        slug: preset.slug,
        name: preset.name,
        description: preset.description,
        isPreset: true,
      })),
    )
    .onConflictDoUpdate({
      target: roles.slug,
      targetWhere: isNull(roles.organizationId),
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: roles.id, slug: roles.slug });

  process.stdout.write(
    `\nSystem seed complete.\n` +
      `  role presets : ${inserted.length} upserted\n` +
      inserted.map((role) => `    - ${role.slug}  ${role.id}\n`).join("") +
      `\n  Permission catalogue and role→permission mapping are phase 4 and are\n` +
      `  deliberately not seeded here.\n\n`,
  );
} finally {
  await connection.close();
}
