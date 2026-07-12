import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client";
import { parsePersistenceEnvironment } from "./env";

const globalForPrisma = globalThis as typeof globalThis & {
  safeExitPrisma?: PrismaClient;
};

export function createPrismaClient(
  environment: NodeJS.ProcessEnv = process.env,
): PrismaClient {
  const config = parsePersistenceEnvironment(environment);
  const adapter = new PrismaPg({ connectionString: config.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export function getPrismaClient(
  environment: NodeJS.ProcessEnv = process.env,
): PrismaClient {
  if (!globalForPrisma.safeExitPrisma) {
    globalForPrisma.safeExitPrisma = createPrismaClient(environment);
  }
  return globalForPrisma.safeExitPrisma;
}

export async function checkDatabaseConnection(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const client = getPrismaClient(environment);
  await client.$queryRaw`SELECT 1`;
}
