import type { Db } from "@/lib/database/client";
import { customerSummary, productHabits } from "@/features/invoices/analytics";

export const PAGE_SIZE = 25;

export async function listCustomers(db: Db, orgId: string, opts: { q?: string; status?: string; page?: number }) {
  const page = Math.max(1, opts.page ?? 1);
  const params: unknown[] = [orgId];
  let where = "c.organization_id = $1";
  if (opts.q) {
    params.push(`%${opts.q.replace(/[%_\\]/g, "")}%`);
    where += ` and (c.legal_name ilike $${params.length} or c.trade_name ilike $${params.length} or c.external_code ilike $${params.length} or c.city ilike $${params.length})`;
  }
  if (opts.status) {
    params.push(opts.status);
    where += ` and c.status = $${params.length}::customer_status`;
  }
  const total = (await db.query<{ n: number }>(`select count(*)::int as n from customers c where ${where}`, params)).rows[0]!.n;
  params.push(PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const rows = (await db.query<{ id: string; external_code: string | null; name: string; city: string | null; segment: string | null; status: string; revenue_12m: string | null; last_purchase: string | null; open_opps: number; owner: string | null }>(
    `select c.id, c.external_code, coalesce(c.trade_name, c.legal_name) as name, c.city, c.segment, c.status,
            (select sum(case when i.doc_type = 'credit_note' then -i.total_ht else i.total_ht end) from invoices i
               where i.customer_id = c.id and i.status = 'issued' and i.invoice_date > current_date - 365) as revenue_12m,
            (select max(i.invoice_date) from invoices i where i.customer_id = c.id and i.status = 'issued' and i.doc_type = 'invoice') as last_purchase,
            (select count(*)::int from opportunities o where o.customer_id = c.id and o.status = 'open') as open_opps,
            m.display_name as owner
     from customers c left join organization_members m on m.organization_id = c.organization_id and m.user_id = c.owner_user_id
     where ${where} order by revenue_12m desc nulls last, name limit $${params.length - 1} offset $${params.length}`, params)).rows;
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getCustomer(db: Db, orgId: string, id: string, today: string) {
  const c = (await db.query<{ id: string; external_code: string | null; legal_name: string; trade_name: string | null; country: string | null; address_line1: string | null; postal_code: string | null; city: string | null; phone: string | null; email: string | null; website: string | null; segment: string | null; status: string; payment_terms: string | null; min_order_amount: string | null; franco_amount: string | null; owner: string | null; notes: string | null }>(
    `select c.*, m.display_name as owner from customers c left join organization_members m on m.organization_id = c.organization_id and m.user_id = c.owner_user_id
     where c.id = $1 and c.organization_id = $2`, [id, orgId])).rows[0];
  if (!c) return null;
  const invoices = (await db.query<{ id: string; invoice_number: string; invoice_date: string; doc_type: "invoice" | "credit_note"; status: "issued" | "cancelled"; total_ht: string; total_ttc: string; payment_status: string }>(
    `select id, invoice_number, invoice_date, doc_type, status, total_ht, total_ttc, payment_status from invoices where customer_id = $1 order by invoice_date desc`, [id])).rows;
  const lines = (await db.query<{ invoice_id: string; product_id: string | null; quantity: string; unit_price_ht: string; line_total_ht: string }>(
    `select l.invoice_id, l.product_id, l.quantity, l.unit_price_ht, l.line_total_ht from invoice_lines l join invoices i on i.id = l.invoice_id where i.customer_id = $1`, [id])).rows;
  const inv = invoices.map((i) => ({ id: i.id, date: i.invoice_date, docType: i.doc_type, status: i.status, totalHt: i.total_ht }));
  const summary = customerSummary(inv, today);
  const habits = productHabits(inv, lines.map((l) => ({ invoiceId: l.invoice_id, productId: l.product_id, quantity: l.quantity, unitPriceHt: l.unit_price_ht, lineTotalHt: l.line_total_ht })), today);
  const productIds = habits.map((h) => h.productId);
  const products = new Map((await db.query<{ id: string; reference: string; name: string; availability: string }>(`select id, reference, name, availability from products where id = any($1::uuid[])`, [productIds])).rows.map((p) => [p.id, p]));
  const contacts = (await db.query<{ id: string; salutation: string | null; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; job_function: string | null; is_primary: boolean; consent_email: boolean; shared_with: number }>(
    `select ct.id, ct.salutation, ct.first_name, ct.last_name, ct.email, ct.phone, cc.job_function, cc.is_primary, ct.consent_email,
            (select count(*)::int - 1 from customer_contacts x where x.contact_id = ct.id) as shared_with
     from customer_contacts cc join contacts ct on ct.id = cc.contact_id where cc.customer_id = $1 order by cc.is_primary desc`, [id])).rows;
  const opportunities = (await db.query<{ id: string; type: string; title: string; justification: string; estimated_value_ht: string | null; confidence: string; status: string; recommended_action: string; offer_id: string | null; data_sources: string[] }>(
    `select id, type, title, justification, estimated_value_ht, confidence, status, recommended_action, offer_id, data_sources from opportunities
     where customer_id = $1 and status in ('open','in_progress') order by priority desc`, [id])).rows;
  const offers = (await db.query<{ id: string; number: string; offer_date: string; status: string; total_ht: string }>(
    `select id, number, offer_date, status, total_ht from offers where customer_id = $1 order by created_at desc limit 10`, [id])).rows;
  const conversations = (await db.query<{ id: string; channel: string; subject: string | null; status: string; last_message_at: string | null; messages: number }>(
    `select c.id, c.channel, c.subject, c.status, c.last_message_at, (select count(*)::int from messages m where m.conversation_id = c.id) as messages
     from conversations c where c.customer_id = $1 order by c.last_message_at desc nulls last limit 10`, [id])).rows;
  const memory = (await db.query<{ id: string; kind: string; certainty: string; content: string; source: string; created_at: string; valid_until: string | null }>(
    `select id, kind, certainty, content, source, created_at, valid_until from agent_memory where customer_id = $1 order by created_at desc limit 12`, [id])).rows;
  return {
    customer: c,
    summary,
    habits: habits.slice(0, 12).map((h) => ({ ...h, product: products.get(h.productId) ?? null })),
    invoices: invoices.slice(0, 15),
    invoiceCount: invoices.length,
    contacts,
    opportunities,
    offers,
    conversations,
    memory,
  };
}
