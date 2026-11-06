import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1).default("postgres://postgres:postgres@localhost:5432/follow_ai"),
  AUTH_MODE: z.enum(["local", "supabase"]).default("local"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET doit contenir au moins 32 caractères"),
  APP_ENCRYPTION_KEY: z.string().optional().default(""),
  LLM_PROVIDER: z.enum(["mock", "anthropic"]).default("mock"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  LLM_MODEL: z.string().default("claude-opus-5-5"),
  IMAGE_PROVIDER: z.enum(["disabled"]).default("disabled"),
  STORAGE_DRIVER: z.enum(["local"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  CRON_SECRET: z.string().optional().default(""),
  WEBHOOK_SIGNING_SECRET: z.string().optional().default(""),
  DEMO_TOOLS: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuration invalide — ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
