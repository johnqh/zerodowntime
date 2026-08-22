import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export const createDb = (url: string) => drizzle(postgres(url), { schema });

export type Db = ReturnType<typeof createDb>;

export { initDb } from "./init";
export * from "./schema";
