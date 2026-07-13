import { z } from "zod";

const postgresUrlSchema = z.string().trim().url().superRefine((value, context) => {
  const protocol = new URL(value).protocol;
  if (protocol !== "postgres:" && protocol !== "postgresql:") {
    context.addIssue({
      code: "custom",
      message: "Expected a PostgreSQL connection URL",
    });
  }
});

export const persistenceEnvironmentSchema = z.strictObject({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: postgresUrlSchema,
  DIRECT_URL: postgresUrlSchema.optional(),
});

export type PersistenceEnvironment = z.infer<typeof persistenceEnvironmentSchema>;

export function parsePersistenceEnvironment(
  environment: NodeJS.ProcessEnv,
): PersistenceEnvironment {
  return persistenceEnvironmentSchema.parse({
    NODE_ENV: environment.NODE_ENV,
    DATABASE_URL: environment.DATABASE_URL?.trim(),
    DIRECT_URL: environment.DIRECT_URL?.trim() || undefined,
  });
}
