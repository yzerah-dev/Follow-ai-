/**
 * Simulateur d'entraînement de LÉA (Academy, module 14).
 * Chaque tour de scénario suit le MÊME chemin que la production, sans base de données :
 *   analyse du message (LLM « analyze_reply ») → décision de remise (politique déterministe) → faits vérifiés
 *   → playbook par la donnée (couverture, offre révisée) → rédaction (LLM « draft_objection_reply », prompt système versionné)
 *   → garde-fous → évaluation (lea-conversation-evaluator).
 * Le fournisseur IA est injecté : simulateur déterministe (mock) ou modèle réel (Anthropic) si une clé est configurée.
 */
import { z } from "zod";
import type { LlmProvider } from "@/lib/ai/types";
import { replyAnalysisSchema, objectionReplySchema, type ReplyAnalysis } from "@/features/agent/schemas";
import { ANALYST_SYSTEM, leaSystem, LEA_PROMPT_VERSION } from "@/features/agent/prompts";
import { parseVoice } from "@/features/agent/voice";
import { checkMessage } from "@/features/agent/guards";
import { answerFromFacts, detectTopics, type Facts } from "@/features/agent/answers";
import { evaluateDiscount, type CommercialPolicy } from "@/features/offers/policy";
import { computeCoverage, type CoverageRow } from "@/features/analytics/coverage";
import { runPlaybook, PLAYBOOK_OBJECTIONS, type Alternative } from "@/features/agent/playbook";
import { mockObjectionReply, type PlaybookCtx } from "@/features/agent/mock-brain";
import { wrapUntrusted } from "@/lib/security/untrusted";
import { evaluateReply, type EvalFacts, type Evaluation, type TurnExpectation } from "@/lib/ai/lea-conversation-evaluator";
import { referenceAnswer, type ObjectionKey } from "@/lib/ai/lea-objection-handler";

export const scenarioSchema = z.object({
  id: z.string(),
  category: z.string(),
  title: z.string(),
  persona: z.string(),
  exam: z.number().int().min(1).max(10).optional(),
  facts: z.object({
    companyName: z.string(),
    senderName: z.string(),
    channel: z.enum(["email", "whatsapp"]),
    today: z.string(),
    contact: z.object({ salutation: z.string().nullable(), firstName: z.string().nullable(), lastName: z.string().nullable() }),
    customerName: z.string(),
    customer: z.object({ francoAmount: z.string().nullable(), minOrderAmount: z.string().nullable(), paymentTerms: z.string().nullable() }),
    policy: z.object({ maxAutoDiscountPct: z.string(), requireDiscountApproval: z.boolean() }),
    offer: z.object({
      number: z.string(), totalHt: z.string(), validUntil: z.string().nullable(), lineCount: z.number().optional(),
      lines: z.array(z.object({
        productId: z.string(), reference: z.string(), description: z.string(), quantity: z.string(), unitPriceHt: z.string(), unitsPerCase: z.number().nullable(),
        availability: z.string(), qtyAvailable: z.string().nullable(), availableFrom: z.string().nullable(),
        purchases: z.array(z.object({ date: z.string(), qty: z.string() })).default([]),
      })),
    }).nullable(),
    salesFacts: z.array(z.string()).default([]),
    alternatives: z.array(z.object({ productId: z.string(), name: z.string(), unitPriceHt: z.string(), minQty: z.string(), reason: z.string() })).default([]),
    documentsAttached: z.boolean().default(false),
    otherCustomerNames: z.array(z.string()).default([]),
  }),
  turns: z.array(z.object({
    customer: z.string(),
    expect: z.object({
      objection: z.string().nullable().optional(),
      intent: z.string().optional(),
      mustInclude: z.array(z.string()).optional(),
      mustNotInclude: z.array(z.string()).optional(),
      expectNoSale: z.boolean().optional(),
    }).default({}),
  })).min(2),
});
export type Scenario = z.infer<typeof scenarioSchema>;

export type TurnResult = { customer: string; reply: string; analysis: ReplyAnalysis; evaluation: Evaluation; reference: string | null; strategy: string | null };
export type ScenarioResult = { id: string; category: string; title: string; exam?: number; score: number; passed: boolean; critical: string[]; turns: TurnResult[] };

export async function simulateScenario(sc: Scenario, llm: LlmProvider): Promise<ScenarioResult> {
  const f = sc.facts;
  const voice = parseVoice({ tone: "dynamic", length: "medium", whatsappEmojis: f.channel === "whatsapp" });
  const policy: CommercialPolicy = { name: null, maxAutoDiscountPct: f.policy.maxAutoDiscountPct, requireDiscountApproval: f.policy.requireDiscountApproval, requireMessageApproval: false, offerValidityDays: 30 };
  let offer = f.offer ? { ...f.offer, lines: [...f.offer.lines] } : null;
  const declared = new Map<string, string>();
  let refusal = false;
  let revisions = 0;
  const knownAmounts = new Set<string>();
  const knownQuantities = new Set<string>();
  const addOfferNumbers = () => {
    if (!offer) return;
    knownAmounts.add(offer.totalHt);
    for (const l of offer.lines) { knownAmounts.add(l.unitPriceHt); knownAmounts.add((Number(l.quantity) * Number(l.unitPriceHt)).toFixed(2)); knownQuantities.add(String(Number(l.quantity))); if (l.qtyAvailable) knownQuantities.add(String(Number(l.qtyAvailable))); }
  };
  addOfferNumbers();
  for (const v of [f.customer.francoAmount, f.customer.minOrderAmount]) if (v) knownAmounts.add(v);
  const turns: TurnResult[] = [];

  for (const [k, t] of sc.turns.entries()) {
    // Montants et quantités cités par le client lui-même : peuvent être repris
    for (const m of t.customer.matchAll(/(\d+(?:[.,]\d+)?)\s?(€|euros?)/gi)) knownAmounts.add(m[1]!.replace(",", "."));
    for (const m of t.customer.matchAll(/(\d+)/g)) knownQuantities.add(m[1]!);

    const analysis = (await llm.structured({ task: "analyze_reply", system: ANALYST_SYSTEM, input: wrapUntrusted("customer_message", t.customer), schema: replyAnalysisSchema, context: { text: t.customer } })).data;
    if (analysis.intent === "unsubscribe" || analysis.objection === "refusal") refusal = true;

    // Décision de remise : 100 % déterministe (comme en production)
    let escalate = false;
    let allowed: number | null = null;
    if (analysis.requestedDiscountPct !== null) {
      const d = evaluateDiscount(policy, analysis.requestedDiscountPct);
      if (d.kind === "escalate") escalate = true;
      else allowed = Number(d.pct);
    } else if (analysis.objection === "competition") escalate = true;

    // Faits vérifiés
    const facts: Facts = {
      offer: offer ? { number: offer.number, validUntil: offer.validUntil, totalHt: offer.totalHt, totalTtc: (Number(offer.totalHt) * 1.2).toFixed(2), lines: offer.lines.map((l) => ({ reference: l.reference, description: l.description, quantity: l.quantity, unitPriceHt: l.unitPriceHt, unitsPerCase: l.unitsPerCase, availability: l.availability, qtyAvailable: l.qtyAvailable, availableFrom: l.availableFrom })) } : null,
      customer: f.customer,
    };
    if (facts.offer) knownAmounts.add(facts.offer.totalTtc);
    const topics = detectTopics(t.customer).filter((x) => !(analysis.objection === "stock_available" && x === "availability"));
    const { answers, unknownLabels } = answerFromFacts(topics, facts, t.customer);
    for (const a of answers) { for (const m of a.matchAll(/(\d[\d\s  ]*(?:[.,]\d{1,2})?)\s?€/g)) knownAmounts.add(m[1]!.replace(/[\s  ]/g, "").replace(",", ".")); for (const m of a.matchAll(/(\d+)/g)) knownQuantities.add(m[1]!); }

    // Playbook par la donnée
    let playbook: PlaybookCtx | null = null;
    let estimates = false;
    if (offer && analysis.intent === "objection" && analysis.objection && PLAYBOOK_OBJECTIONS.includes(analysis.objection) && !(allowed && allowed > 0)) {
      let declaredStock: PlaybookCtx["declaredStock"] = null;
      const qty = analysis.objection === "stock_available" ? analysis.requestedQuantity?.match(/\d+/)?.[0] : null;
      if (qty) {
        const low = t.customer.toLowerCase();
        const target = offer.lines.length === 1 ? offer.lines[0]! : offer.lines.find((l) => low.includes(l.description.toLowerCase())) ?? null;
        if (target) declared.set(target.productId, qty);
        declaredStock = { qty, productName: target?.description ?? null };
      }
      const coverage = new Map<string, CoverageRow>(offer.lines.map((l) => [l.productId, computeCoverage({
        productId: l.productId, reference: l.reference, name: l.description, unitsPerCase: l.unitsPerCase, minOrderQty: null, purchases: l.purchases, today: f.today,
        report: declared.has(l.productId) ? { qtyOnHand: declared.get(l.productId)!, unitsSoldPerDay: null, reportedAt: `${f.today}T09:00:00Z`, source: "customer_message" } : null,
      })]));
      for (const c of coverage.values()) { if (c.stockOnHand) knownQuantities.add(c.stockOnHand); if (c.coverageDays !== null) knownQuantities.add(String(c.coverageDays)); if (c.recommendedQty) knownQuantities.add(String(Number(c.recommendedQty))); if (c.stockSource === "estimated" || c.rateSource === "estimated") estimates = true; }
      const budget = (/budget/i.test(t.customer) && analysis.targetPrice) ? analysis.targetPrice.match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(",", ".") ?? null : null;
      const r = runPlaybook({ objection: analysis.objection, lines: offer.lines.map((l) => ({ productId: l.productId, name: l.description, quantity: l.quantity, unitPriceHt: l.unitPriceHt })), coverage, budgetHt: budget, priorRevisions: revisions, alternatives: f.alternatives as Alternative[], today: f.today });
      const unknownRef = !!declaredStock && !declaredStock.productName && offer.lines.length > 1;
      if (unknownRef) Object.assign(r, { strategy: "hold", items: [], removed: [], counterArguments: [], estimatedTotalHt: null, followUpDate: null, question: `Pour affiner, de quelle(s) référence(s) vous reste-t-il ${Number(declaredStock!.qty)} pièces ? Je recalcule aussitôt la proposition.` });
      let revised: PlaybookCtx["revised"] = null;
      if (r.strategy === "revise" && r.estimatedTotalHt) {
        revisions++;
        const number = `${offer.number}-R${revisions}`;
        revised = { number, totalHt: r.estimatedTotalHt, originalTotalHt: offer.totalHt, documents: [`Offre-${number}.pdf`, `Analyse-${number}.xlsx`] };
        knownAmounts.add(r.estimatedTotalHt);
        offer = { ...offer, number, totalHt: r.estimatedTotalHt, lines: offer.lines.filter((l) => r.items.some((i) => i.productId === l.productId)).map((l) => ({ ...l, quantity: r.items.find((i) => i.productId === l.productId)!.qty })) };
        addOfferNumbers();
        allowed = null;
      }
      if (r.strategy === "respect" && revisions >= 2) escalate = true;
      playbook = { strategy: r.strategy, counterArguments: r.counterArguments, removed: r.removed, question: r.question, followUpDate: r.followUpDate, declaredStock, revised };
    }

    const turn = turns.length;
    const context = {
      analysis, customerName: f.customerName, contact: f.contact, offer: offer ? { number: offer.number, totalHt: offer.totalHt, validUntil: offer.validUntil } : null,
      allowedDiscountPct: allowed, escalate, senderName: f.senderName, companyName: f.companyName, channel: f.channel, answers, unknownLabels, turn, voice,
      salesFacts: f.salesFacts, playbook,
    };
    const input = `Rédige la réponse au client. Remise maximale utilisable : ${allowed ?? 0} %. ${escalate ? "Dossier transféré au commercial : annonce-le sans rien promettre." : ""}
Canal : ${f.channel}. Réponses factuelles autorisées : ${answers.join(" | ") || "aucune"}. Sujets sans donnée fiable : ${unknownLabels.join(", ") || "aucun"}.
Arguments vérifiés : ${f.salesFacts.join(" | ") || "aucun"}.
${playbook ? `PLAYBOOK : stratégie ${playbook.strategy} ; contre-arguments : ${playbook.counterArguments.join(" | ") || "aucun"} ; ${playbook.revised ? `offre révisée ${playbook.revised.number} : ${playbook.revised.totalHt} € HT au lieu de ${playbook.revised.originalTotalHt} € HT` : ""} ; question : ${playbook.question}` : ""}
Données : ${wrapUntrusted("system_data", JSON.stringify({ customerName: f.customerName, contact: f.contact, offer: context.offer, analysis }))}
Message du client : ${wrapUntrusted("customer_message", t.customer)}`;
    let reply = (await llm.structured({ task: "draft_objection_reply", system: leaSystem(voice, f.companyName), input, schema: objectionReplySchema, context })).data;
    const guard = checkMessage(reply.body, { allowedDiscountPct: allowed, personalizedAllowed: true, knownAmounts: [...knownAmounts] }); // mêmes garde-fous qu'en production
    if (!guard.ok || (reply.proposedDiscountPct ?? 0) > (allowed ?? 0)) reply = mockObjectionReply(context); // repli sûr, comme en production
    if (allowed) knownAmounts.add(String(allowed));

    const evalFacts: EvalFacts = {
      channel: f.channel, contactLastName: f.contact.lastName, knownAmounts: [...knownAmounts], knownQuantities: [...knownQuantities], allowedDiscountPct: allowed,
      deliveryConfirmed: false, documentsAttached: f.documentsAttached || !!playbook?.revised, otherCustomerNames: f.otherCustomerNames, refusal, estimates,
    };
    const expect: TurnExpectation = { ...t.expect, objection: (t.expect.objection ?? (analysis.intent === "complaint" ? "delivery_late" : analysis.intent === "unsubscribe" ? "unsubscribe" : analysis.objection)) as ObjectionKey | null, firstTurn: k === 0 };
    const evaluation = evaluateReply(reply.body, evalFacts, expect);
    const refKey = expect.objection ?? null;
    turns.push({ customer: t.customer, reply: reply.body, analysis, evaluation, reference: refKey ? referenceAnswer(refKey, { prepared: evalFacts.documentsAttached }) || null : null, strategy: playbook?.strategy ?? null });
    if (refusal) break; // après un refus explicite, la conversation commerciale s'arrête
  }
  const score = Math.round(turns.reduce((a, t) => a + t.evaluation.score, 0) / turns.length);
  const critical = [...new Set(turns.flatMap((t) => t.evaluation.critical))];
  return { id: sc.id, category: sc.category, title: sc.title, exam: sc.exam, score, passed: critical.length === 0 && turns.every((t) => t.evaluation.passed), critical, turns };
}

export { LEA_PROMPT_VERSION };
