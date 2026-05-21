import { SQL } from "bun";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://cam_blindspot:cam_blindspot@localhost:5432/cam_blindspot";

export const sql = new SQL(databaseUrl);

export async function closeDb() {
  await sql.close();
}
