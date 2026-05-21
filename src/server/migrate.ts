import { sql } from "./db";

const migrationsDir = new URL("../../migrations/", import.meta.url);

export async function migrate() {
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

if (import.meta.main) {
  await migrate();
  await sql.close();
}
