import { sql } from "./db";

const migrationsDir = new URL("../../migrations/", import.meta.url);

export async function migrate() {
  const maxAttempts = Number(process.env.MIGRATION_ATTEMPTS ?? 30);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runMigrations();
      return;
    } catch (error) {
      if (attempt === maxAttempts || !isTransientDatabaseStartupError(error)) {
        throw error;
      }
      console.log(`database not ready for migrations, retrying (${attempt}/${maxAttempts})`);
      await Bun.sleep(2000);
    }
  }
}

async function runMigrations() {
  await sql.unsafe(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const files = await Array.fromAsync(new Bun.Glob("*.sql").scan({ cwd: migrationsDir.pathname }));
  files.sort();

  for (const file of files) {
    const applied = await sql<{ version: string }[]>`
      select version from schema_migrations where version = ${file}
    `;
    if (applied.length > 0) continue;

    const content = await Bun.file(new URL(file, migrationsDir)).text();
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`insert into schema_migrations (version) values (${file})`;
    });
    console.log(`applied migration ${file}`);
  }
}

function isTransientDatabaseStartupError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("connection closed") ||
    message.includes("connection refused") ||
    message.includes("database system is starting up") ||
    message.includes("database system is shutting down")
  );
}

if (import.meta.main) {
  await migrate();
  await sql.close();
}
