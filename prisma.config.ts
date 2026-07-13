import "dotenv/config";

import { defineConfig } from "prisma/config";

const generationOnlyUrl =
  "postgresql://safeexit:unused@127.0.0.1:5432/safeexit?schema=public";
const directUrl = process.env.DIRECT_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Prisma client generation does not connect. Runtime access still validates DATABASE_URL.
    url: directUrl || databaseUrl || generationOnlyUrl,
  },
});
