import { env } from "@/lib/env";
import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";
import type { LlmProvider } from "./types";

let provider: LlmProvider | null = null;

export function getLlm(): LlmProvider {
  if (provider) return provider;
  const e = env();
  if (e.LLM_PROVIDER === "anthropic" && e.ANTHROPIC_API_KEY) provider = new AnthropicProvider(e.LLM_MODEL, e.ANTHROPIC_API_KEY);
  else provider = new MockProvider();
  return provider;
}

export function setLlmForTests(p: LlmProvider | null) {
  provider = p;
}
