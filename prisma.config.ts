import "dotenv/config";

import { defineConfig } from "prisma/config";

const generationOnlyUrl =
  "postgresql://safeexit:unused@127.0.0.1:5432/safeexit?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Prisma client generation does not connect. Runtime access still validates DATABASE_URL.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? generationOnlyUrl,
  },
});
