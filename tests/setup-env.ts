// Variables d'environnement des tests (aucun service externe, IA simulée).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/follow_ai_test";
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters-long";
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.LLM_PROVIDER = "mock";
process.env.STORAGE_LOCAL_DIR = "./storage-test";
process.env.WEBHOOK_SIGNING_SECRET = "whsec-test";
process.env.CRON_SECRET = "cron-test";
