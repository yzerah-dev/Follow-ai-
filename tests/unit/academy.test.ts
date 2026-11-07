/**
 * Régression LÉA Sales Academy : les 105 scénarios passent avec le cerveau déterministe (≥ 90/100, aucune erreur critique),
 * et l'évaluateur recale un modèle qui invente (prix, stock, remise, délai, confidentialité, refus).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { MockProvider } from "@/lib/ai/mock";
import type { LlmProvider } from "@/lib/ai/types";
import { simulateScenario, scenarioSchema, type Scenario } from "@/features/training/simulator";
import { evaluateReply, PASS_SCORE, type EvalFacts } from "@/lib/ai/lea-conversation-evaluator";
import { LEA_SYSTEM, LEA_PROMPT_VERSION } from "@/features/agent/prompts";
import { BANNED_EXPRESSIONS } from "@/lib/ai/lea-personality";
import { mockFollowup } from "@/features/agent/mock-brain";

const dir = new URL("../../training/scenarios/", import.meta.url);
const scenarios: Scenario[] = readdirSync(dir).filter((f) => f.endsWith(".json")).flatMap((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")).map((s: unknown) => scenarioSchema.parse(s)));

describe("Scénarios d'entraînement", () => {
  it("au moins 100 scénarios, 15 catégories, plusieurs échanges chacun", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(100);
    expect(new Set(scenarios.map((s) => s.category)).size).toBe(15);
    expect(scenarios.every((s) => s.turns.length >= 2)).toBe(true);
  });
  it(`chaque scénario atteint ${PASS_SCORE}/100 sans erreur critique (cerveau déterministe)`, async () => {
    const llm = new MockProvider();
    const failures: string[] = [];
    for (const s of scenarios) {
      const r = await simulateScenario(s, llm);
      if (!r.passed) failures.push(`${s.id} ${r.score} ${r.critical.join(",")} ${r.turns.flatMap((t) => t.evaluation.issues).join(" ")}`);
    }
    expect(failures).toEqual([]);
  });
});

/** Fournisseur factice qui « hallucine » : doit être recalé par l'évaluateur (et rattrapé par les garde-fous quand c'est possible). */
class InventingProvider implements LlmProvider {
  readonly name = "mock" as const;
  readonly model = "inventeur";
  readonly simulated = true;
  constructor(private body: string) {}
  async structured<T>(req: { task: string; schema: { parse: (x: unknown) => T }; context?: unknown }) {
    const base = new MockProvider();
    if (req.task === "analyze_reply") return base.structured(req as never) as never;
    return { data: req.schema.parse({ subject: "RE: votre message", body: this.body, proposedDiscountPct: null, rationale: "test" }), usage: { inputTokens: 0, outputTokens: 0 }, provider: "mock", model: this.model, simulated: true };
  }
}

describe("Évaluateur : erreurs critiques éliminatoires", () => {
  const facts: EvalFacts = { channel: "email", contactLastName: "Martin", knownAmounts: ["686.40", "9.90"], knownQuantities: ["24"], allowedDiscountPct: null, deliveryConfirmed: false, documentsAttached: false, otherCustomerNames: ["Leclerc Rennes"], refusal: false, estimates: false };
  const cases: [string, string, EvalFacts?][] = [
    ["prix_invente", "Bonjour Monsieur Martin, je peux vous faire ce produit à 7,50 € HT. On valide ?"],
    ["stock_invente", "Bonjour Monsieur Martin, il vous reste 120 pièces en stock, je vous propose de valider ?"],
    ["remise_non_autorisee", "Bonjour Monsieur Martin, je vous accorde 5 % de remise. On valide ?"],
    ["livraison_non_verifiee", "Bonjour Monsieur Martin, vous serez livré demain sans faute. Je reviens vers vous ?"],
    ["confidentialite", "Bonjour Monsieur Martin, Leclerc Rennes en a pris 200, et notre marge est faible. On valide ?"],
    ["refus_non_respecte", "Bonjour Monsieur Martin, bien compris. Je vous propose une nouvelle proposition avec nos nouveautés ?", { ...facts, refusal: true }],
  ];
  for (const [kind, body, f] of cases) it(`détecte : ${kind}`, () => {
    const e = evaluateReply(body, f ?? facts, { firstTurn: true });
    expect(e.critical).toContain(kind);
    expect(e.passed).toBe(false);
  });
  it("une date de livraison inventée par le modèle est bloquée par le garde-fou de production (repli sûr)", async () => {
    const sc = scenarios.find((s) => s.id === "client-mecontent-1")!;
    const r = await simulateScenario(sc, new InventingProvider("Bonjour Monsieur Martin, pas d'inquiétude : vous serez livré demain. Je vous propose de valider la commande ?") as never);
    expect(r.turns.every((t) => !/livré demain/.test(t.reply))).toBe(true);
    expect(r.critical).not.toContain("livraison_non_verifiee");
  });
  it("un prix inventé par le modèle est bloqué par le garde-fou de production (montants vérifiés uniquement)", async () => {
    const sc = scenarios.find((s) => s.id === "acheteur-sympathique-1")!;
    const r = await simulateScenario(sc, new InventingProvider("Bonjour Monsieur Martin, ce produit est à 7,77 € HT. On valide la commande ?") as never);
    expect(r.turns.every((t) => !/7,77/.test(t.reply))).toBe(true);
    expect(r.critical).not.toContain("prix_invente");
  });
  it("une remise hors politique proposée par le modèle est neutralisée par le garde-fou de production (repli sûr)", async () => {
    const sc = scenarios.find((s) => s.id === "negociation-difficile-1")!;
    const r = await simulateScenario(sc, new InventingProvider("Bonjour Monsieur Martin, d'accord pour 5 % de remise. On valide ?") as never);
    expect(r.turns[0]!.reply).not.toMatch(/5\s?%/);
    expect(r.critical).not.toContain("remise_non_autorisee");
  });
});

describe("Prompt système versionné", () => {
  it("contient la formation (personnalité, P.R.O.V.E., conclusion) et conserve les règles impératives de sécurité", () => {
    expect(LEA_PROMPT_VERSION).toBe("academy-1.0");
    expect(LEA_SYSTEM).toMatch(/commerciale IA B2B senior/);
    expect(LEA_SYSTEM).toMatch(/P\.R\.O\.V\.E\./);
    expect(LEA_SYSTEM).toMatch(/Tu n'inventes JAMAIS de fait, prix, stock, délai, remise/);
    expect(LEA_SYSTEM).toMatch(/Tu ne promets aucune remise/);
  });
  it("les gabarits de LÉA n'emploient aucune expression interdite", () => {
    const f = mockFollowup({ contact: { salutation: "M.", firstName: null, lastName: "Martin" }, offer: { number: "OF-1", totalHt: "100", validUntil: null }, attempt: 1, senderName: "Bruno", companyName: "JONAS" });
    for (const b of BANNED_EXPRESSIONS) expect(f.body).not.toMatch(b.re);
  });
});
