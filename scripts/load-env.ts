import fs from "node:fs";
import path from "node:path";

/** Charge .env.local puis .env (sans écraser les variables déjà définies). */
export function loadEnvFile() {
  for (const name of [".env.local", ".env"]) {
    const p = path.resolve(process.cwd(), name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2]?.replace(/^"|"$/g, "");
    }
  }
}
