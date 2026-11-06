import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { LlmError, type LlmProvider, type StructuredRequest, type StructuredResult } from "./types";

/**
 * Fournisseur Claude (API Anthropic officielle) — sorties structurées validées par Zod.
 * Repli serveur activé (fallbacks "default") en cas de refus du modèle principal.
 * Non exécuté dans les tests : nécessite ANTHROPIC_API_KEY.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly simulated = false;
  private client: Anthropic;

  constructor(readonly model: string, apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: req.maxTokens ?? 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(req.schema) },
        system: req.system,
        messages: [{ role: "user", content: req.input }],
      } as Parameters<typeof this.client.beta.messages.parse>[0]);
      if (response.stop_reason === "refusal") throw new LlmError("Le modèle a refusé de traiter la demande.");
      if (response.stop_reason === "max_tokens") throw new LlmError("Réponse tronquée (max_tokens).", true);
      const parsed = response.parsed_output as T | null;
      if (parsed === null || parsed === undefined) throw new LlmError("Sortie structurée invalide.", true);
      return {
        data: req.schema.parse(parsed),
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
        provider: this.name,
        model: response.model,
        simulated: false,
      };
    } catch (e) {
      if (e instanceof LlmError) throw e;
      if (e instanceof Anthropic.RateLimitError) throw new LlmError("Limite de débit IA atteinte, réessayer plus tard.", true);
      if (e instanceof Anthropic.AuthenticationError) throw new LlmError("Clé API Anthropic invalide.");
      if (e instanceof Anthropic.APIError) throw new LlmError(`Erreur API IA (${e.status}).`, (e.status ?? 0) >= 500);
      throw e;
    }
  }
}

/** Tarifs indicatifs (USD / million de jetons) pour le suivi des coûts. */
export const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export function estimateCostUsd(model: string, usage: { inputTokens: number; outputTokens: number }): number {
  const p = PRICING_PER_MTOK[model];
  if (!p) return 0;
  return (usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000;
}
