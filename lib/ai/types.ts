import type { z } from "zod";

export type LlmUsage = { inputTokens: number; outputTokens: number };

export type StructuredRequest<T> = {
  /** Identifiant de tâche (sert au routage du fournisseur simulé et au suivi des coûts). */
  task: string;
  system: string;
  /** Prompt utilisateur — les contenus externes y sont encapsulés via wrapUntrusted(). */
  input: string;
  schema: z.ZodType<T>;
  /** Contexte structuré (utilisé par le fournisseur simulé, qui ne « lit » pas le texte). */
  context: unknown;
  maxTokens?: number;
};

export type StructuredResult<T> = { data: T; usage: LlmUsage; provider: string; model: string; simulated: boolean };

export interface LlmProvider {
  readonly name: "mock" | "anthropic";
  readonly model: string;
  /** true = aucune IA réelle : les sorties sont produites par des règles déterministes. */
  readonly simulated: boolean;
  structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
}

export class LlmError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
  }
}
