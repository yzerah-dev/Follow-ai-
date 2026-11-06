"use server";

import { z } from "zod";
import { db } from "@/lib/auth/context";
import { getLlm } from "@/lib/ai";
import { chatAnswerSchema, type ChatAnswer } from "@/features/agent/schemas";
import { LEA_SYSTEM } from "@/features/agent/prompts";
import { wrapUntrusted } from "@/lib/security/untrusted";
import { rateLimit } from "@/lib/security/rate-limit";
import { formatMoney } from "@/lib/money";

const schema = z.string().trim().min(1).max(1000);

export async function askLeaAction(question: string): Promise<ChatAnswer & { simulated: boolean }> {
  const q = schema.parse(question);
  return db(async (d, ctx) => {
    if (!rateLimit(`lea:${ctx.userId}`, 30, 60_000).ok) return { answer: "Trop de demandes en peu de temps, réessayez dans une minute.", suggestions: [], simulated: true };
    const orgId = ctx.org.organizationId;
    const top = (await d.query<{ id: string; customer_id: string; name: string; title: string; value: string | null; justification: string }>(
      `select o.id, o.customer_id, coalesce(c.trade_name, c.legal_name) as name, o.title, o.estimated_value_ht as value, o.justification
       from opportunities o join customers c on c.id = o.customer_id where o.organization_id = $1 and o.status = 'open' order by o.priority desc limit 5`, [orgId])).rows;
    const counts = (await d.query<{ dormant: number; approvals: number; replies: number }>(
      `select (select count(*)::int from opportunities where organization_id = $1 and status = 'open' and type = 'dormant_customer') as dormant,
              (select count(*)::int from approvals where organization_id = $1 and status = 'pending') as approvals,
              (select count(*)::int from messages where organization_id = $1 and direction = 'inbound' and not handled) as replies`, [orgId])).rows[0]!;
    const facts = {
      question: q,
      topOpportunities: top.map((t) => ({ customer: t.name, title: t.title, value: t.value, href: `/clients/${t.customer_id}` })),
      dormantCount: counts.dormant,
      pendingApprovals: counts.approvals,
      repliesToHandle: counts.replies,
    };
    const llm = getLlm();
    const res = await llm.structured({
      task: "lea_chat",
      system: `${LEA_SYSTEM}\nTu réponds ici à un commercial de l'entreprise (utilisateur interne), de façon brève et actionnable. Les liens proposés doivent provenir des données fournies.`,
      input: `Question du commercial :\n${wrapUntrusted("user_question", q, 1000)}\n\nDonnées du système :\n${wrapUntrusted("system_data", JSON.stringify({ ...facts, topOpportunities: top.map((t) => ({ ...t, value: t.value ? formatMoney(t.value) : null })) }))}`,
      schema: chatAnswerSchema,
      context: facts,
      maxTokens: 1500,
    });
    // Seuls des liens internes sont autorisés
    const suggestions = res.data.suggestions.filter((s) => s.href.startsWith("/") && !s.href.startsWith("//"));
    return { ...res.data, suggestions, simulated: res.simulated };
  });
}
