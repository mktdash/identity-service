import { sql } from "drizzle-orm";
import { TENANT_SETTINGS } from "#config/constants";
import { db } from "#db/client";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type TenantScope = {
  readonly organizationId: string;
  readonly workspaceId?: string | undefined;
};

export async function setTenantScope(
  tx: Transaction,
  scope: TenantScope,
): Promise<void> {
  await tx.execute(
    sql`select set_config(${TENANT_SETTINGS.organizationId}, ${scope.organizationId}, true)`,
  );

  await tx.execute(
    sql`select set_config(${TENANT_SETTINGS.workspaceId}, ${scope.workspaceId ?? ""}, true)`,
  );
}

export async function withTenant<T>(
  scope: TenantScope,
  run: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await setTenantScope(tx, scope);
    return run(tx);
  });
}

export async function nextId(tx: Transaction): Promise<string> {
  const rows = await tx.execute<{ id: string }>(sql`select uuidv7() as id`);
  const id = rows.at(0)?.id;

  if (id === undefined) {
    throw new Error(
      "uuidv7() returned no row — is this PostgreSQL 18 or newer?",
    );
  }

  return id;
}
