import postgres from 'postgres';

export type Database = ReturnType<typeof postgres>;

export async function connect(url: string): Promise<Database> {
  const sql = postgres(url, { max: 2 });
  await sql`select 1`;
  return sql;
}
