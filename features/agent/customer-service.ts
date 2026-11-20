/**
 * Service client : questions que le CLIENT pose de lui-même, sans offre en cours.
 * « Quand je reçois ma commande ? », « As-tu cette référence en stock ? », « Envoie-moi ma facture », « Envoie-moi mon bon de commande ».
 *
 * Réponses 100 % déterministes, tirées des données de l'organisation et du client de la conversation (jamais d'un autre client) :
 * - date de livraison : jamais inventée (aucune donnée logistique) → statut réel de la commande + tâche pour le commercial ;
 * - stock : disponibilité et quantité du dernier relevé, avec sa date ; inconnu → commercial ;
 * - facture : le PDF n'est envoyé que s'il a été importé (document de l'ERP) ; une facture n'est jamais générée par LÉA ;
 * - bon de commande : récapitulatif PDF de la demande de commande enregistrée dans LÉA.AI.
 * Pièces jointes envoyées uniquement selon les règles d'autonomie (identité vérifiée, mode de l'organisation).
 */
import { rgb } from "pdf-lib";
import type { Db } from "@/lib/database/client";
import { dec, formatMoney } from "@/lib/money";
import { audit } from "@/lib/security/audit";
import { fileExists, putFile, storagePath } from "@/lib/storage";
import { createDoc, footer, header, text, textRight, A4 } from "@/lib/documents/pdf";
import { loadBrand } from "@/features/creative-studio/service";
import { loadAutonomy } from "@/features/settings/policy-repo";
import { dispatchMessage, type DispatchResult } from "@/features/conversations/dispatch";
import { decideAutonomy, type AutonomyDecision } from "./autonomy";
import { greeting } from "./mock-brain";
import { emoji, parseVoice, signoff } from "./voice";

export type ServiceKind = "order_status" | "stock" | "invoice" | "order_form";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const DETECT: { kind: ServiceKind; re: RegExp }[] = [
  { kind: "order_form", re: /bon de commande|confirmation de (ma |la )?commande|recap(itulatif)? de (ma |la )?commande/ },
  { kind: "invoice", re: /\bfactures?\b|duplicata/ },
  {
    kind: "order_status",
    re: /(quand|ou en est|suivi|statut|date).{0,40}(commande|livraison|colis|marchandise)|(recevoir|recois|recevrai|recevons|recevrons|livre|livree|livrez|expedie|expediee).{0,40}(commande|marchandise|colis)|ma commande.{0,30}(arrive|part|expedi|livr)/,
  },
  { kind: "stock", re: /\ben stock\b|\bdispo(nible)?s?\b|disponibilite|(avez|as)[- ](vous|tu)|vous (en )?avez|il (vous )?(en )?reste|reste-t-il|en rupture/ },
];

/** Demandes de service détectées dans le message (ordre stable). Le stock n'est confirmé qu'une fois le produit identifié. */
export function detectServiceRequests(body: string): ServiceKind[] {
  const t = norm(body);
  return DETECT.filter((d) => d.re.test(t)).map((d) => d.kind).filter((k, _, all) => !(k === "order_status" && all.includes("order_form") && !/quand|livr|recev|arrive/.test(t)));
}

const STOP = new Set(["bonjour", "bonsoir", "merci", "stock", "dispo", "disponible", "disponibles", "avez", "vous", "est-ce", "cette", "reference", "references", "produit", "article", "encore", "combien", "quand", "votre", "notre", "pour", "avec", "dans", "chez", "jonas", "pieces", "piece", "reste", "rupture", "auriez", "avoir", "bien", "aussi", "alors", "voila", "salut", "madame", "monsieur", "svp", "plait", "possible", "besoin", "commande", "commander"]);

type FoundProduct = { id: string; reference: string; name: string; availability: string; available_from: string | null; units_per_case: number | null; status: string; qty_available: string | null; captured_at: string | null };

/** Produits cités : référence ou EAN exacts d'abord, sinon meilleure correspondance sur le nom (mots significatifs). */
export async function findProductsInText(db: Db, orgId: string, body: string): Promise<{ products: FoundProduct[]; ambiguous: FoundProduct[] }> {
  const cols = `p.id, p.reference, p.name, p.availability::text, p.available_from::text, p.units_per_case, p.status,
    (select s.qty_available::text from inventory_snapshots s where s.product_id = p.id order by s.captured_at desc limit 1) as qty_available,
    (select s.captured_at::date::text from inventory_snapshots s where s.product_id = p.id order by s.captured_at desc limit 1) as captured_at`;
  const tokens = [...new Set(body.toUpperCase().match(/\b[A-Z0-9][A-Z0-9_-]{2,}\b/g) ?? [])].filter((t) => /\d/.test(t));
  const eans = tokens.filter((t) => /^\d{8,14}$/.test(t));
  if (tokens.length) {
    const exact = (await db.query<FoundProduct>(`select ${cols} from products p where p.organization_id = $1 and (upper(p.reference) = any($2::text[]) or p.ean = any($3::text[])) limit 10`, [orgId, tokens, eans])).rows;
    if (exact.length) return { products: exact, ambiguous: [] };
  }
  const words = [...new Set(norm(body).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)))].slice(0, 8);
  if (!words.length) return { products: [], ambiguous: [] };
  const rows = (await db.query<FoundProduct & { score: number }>(
    `select ${cols}, (select count(*)::int from unnest($2::text[]) w
            where translate(lower(p.name), 'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc') like '%' || w || '%') as score
     from products p where p.organization_id = $1 and p.status = 'active'
     order by score desc, p.is_new desc, p.name limit 5`, [orgId, words])).rows.filter((r) => r.score > 0);
  if (!rows.length) return { products: [], ambiguous: [] };
  const best = rows[0]!.score;
  const top = rows.filter((r) => r.score === best);
  // Un mot isolé correspondant à plusieurs produits : on demande lequel plutôt que de choisir au hasard.
  return top.length === 1 ? { products: top, ambiguous: [] } : { products: [], ambiguous: top.slice(0, 3) };
}

const dateFr = (d: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`));

export function stockSentence(p: FoundProduct): { text: string; available: boolean; unknown: boolean } {
  const label = `« ${p.name} » (réf. ${p.reference})`;
  const asOf = p.captured_at ? ` (stock du ${dateFr(p.captured_at)})` : "";
  const qty = p.qty_available !== null ? dec(p.qty_available) : null;
  const pack = p.units_per_case && p.units_per_case > 1 ? `, vendu par colis de ${p.units_per_case}` : "";
  if (p.status !== "active") return { text: `${label} n'est plus proposé à la vente.`, available: false, unknown: false };
  if ((qty && qty.gt(0)) || (qty === null && p.availability === "in_stock"))
    return { text: `Oui, ${label} est disponible${qty ? ` : ${qty.toFixed(0)} pièces en stock${asOf}` : " en stock"}${pack}.`, available: true, unknown: false };
  if ((qty && qty.lte(0)) || p.availability === "out_of_stock" || p.availability === "on_order")
    return { text: `${label} est en rupture pour le moment${p.available_from ? `, de retour à partir du ${dateFr(p.available_from)}` : " : je vérifie la date de retour avec votre commercial"}.`, available: false, unknown: !p.available_from };
  return { text: `Pour ${label}, je vérifie la disponibilité avec votre commercial.`, available: false, unknown: true };
}

type Doc = { filename: string; storagePath: string; mimeType: string };
type Part = { lines: string[]; close?: string; docs?: Doc[]; tasks?: { title: string; notes: string }[]; answered: number; unanswered: number };

/** Bon de commande PDF (récapitulatif de la demande de commande enregistrée). Généré une fois, puis réutilisé. */
async function orderFormPdf(db: Db, orgId: string, order: { id: string; number: string; created_at: string; total_ht: string; total_ttc: string; lines: { reference: string; description: string; quantity: string; unit_price_ht: string; line_total_ht: string }[] }, customerName: string): Promise<Doc> {
  const filename = `Bon-de-commande-${order.number}.pdf`;
  const path = storagePath(orgId, "orders", order.id, filename);
  if (!(await fileExists(path))) {
    const { brand } = await loadBrand(db, orgId, "offer_pdf");
    const c = await createDoc(brand, `Bon de commande ${order.number}`);
    let page = c.doc.addPage([A4.w, A4.h]);
    header(page, c, "Bon de commande", order.number);
    text(page, c, `Client : ${customerName}`, 40, A4.h - 120, 11, { bold: true });
    text(page, c, `Date : ${dateFr(order.created_at)} ${order.created_at.slice(0, 4)}`, 40, A4.h - 136, 10);
    const head = (y: number) => {
      ["Référence", "Désignation"].forEach((h, i) => text(page, c, h, [40, 130][i]!, y, 9, { bold: true }));
      textRight(page, c, "Qté", 400, y, 9, true); textRight(page, c, "PU HT", 470, y, 9, true); textRight(page, c, "Total HT", A4.w - 40, y, 9, true);
      page.drawLine({ start: { x: 40, y: y - 4 }, end: { x: A4.w - 40, y: y - 4 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.85) });
    };
    let y = A4.h - 170;
    head(y);
    y -= 18;
    for (const l of order.lines) {
      if (y < 90) { page = c.doc.addPage([A4.w, A4.h]); header(page, c, "Bon de commande", order.number); y = A4.h - 120; head(y); y -= 18; }
      text(page, c, l.reference, 40, y, 9);
      text(page, c, l.description, 130, y, 9, { maxWidth: 230 });
      textRight(page, c, String(Number(l.quantity)), 400, y, 9);
      textRight(page, c, formatMoney(l.unit_price_ht), 470, y, 9);
      textRight(page, c, formatMoney(l.line_total_ht), A4.w - 40, y, 9);
      y -= 16;
    }
    y -= 8;
    textRight(page, c, `Total HT : ${formatMoney(order.total_ht)}`, A4.w - 40, y, 10, true);
    textRight(page, c, `Total TTC : ${formatMoney(order.total_ttc)}`, A4.w - 40, y - 16, 10, true);
    const pages = c.doc.getPages();
    pages.forEach((p, i) => footer(p, c, i + 1, pages.length));
    await putFile(path, Buffer.from(await c.doc.save()));
  }
  return { filename, storagePath: path, mimeType: "application/pdf" };
}

export type ServiceReplyResult = { kinds: ServiceKind[]; replyMessageId: string; decision: AutonomyDecision; dispatch: DispatchResult | null; summary: string };

/**
 * Répond aux demandes de service. Retourne null si rien n'est à traiter ici (ex. « c'est dispo ? » sur l'offre en cours :
 * la réponse habituelle sur les lignes de l'offre s'applique).
 */
export async function answerServiceRequests(db: Db, orgId: string, inboundId: string, opts: { now?: Date } = {}): Promise<ServiceReplyResult | null> {
  const m = (await db.query<{ body: string; conversation_id: string; from_address: string | null; channel: "email" | "whatsapp"; customer_id: string | null; customer_name: string | null; offer_id: string | null; identity: string; salutation: string | null; first_name: string | null; last_name: string | null }>(
    `select m.body, m.conversation_id, m.from_address, c.channel, c.customer_id, coalesce(cu.trade_name, cu.legal_name) as customer_name, c.offer_id, c.identity_confidence as identity,
            ct.salutation, ct.first_name, ct.last_name
     from messages m join conversations c on c.id = m.conversation_id left join customers cu on cu.id = c.customer_id left join contacts ct on ct.id = c.contact_id
     where m.id = $1 and m.organization_id = $2 and m.direction = 'inbound'`, [inboundId, orgId])).rows[0];
  if (!m) throw new Error("Message introuvable.");
  let kinds = detectServiceRequests(m.body);
  if (!kinds.length) return null;

  const parts: Part[] = [];
  if (kinds.includes("stock")) {
    const found = await findProductsInText(db, orgId, m.body);
    if (found.products.length) {
      const s = found.products.slice(0, 5).map(stockSentence);
      parts.push({ lines: s.map((x) => x.text), close: s.some((x) => x.available) ? "Souhaitez-vous que je vous en prépare ?" : undefined, answered: s.filter((x) => !x.unknown).length, unanswered: s.filter((x) => x.unknown).length,
        tasks: s.some((x) => x.unknown) ? [{ title: "Disponibilité à confirmer au client", notes: s.filter((x) => x.unknown).map((x) => x.text).join("\n") }] : undefined });
    } else if (found.ambiguous.length) {
      parts.push({ lines: [`Pour être sûre de vous répondre juste, de quel produit s'agit-il : ${found.ambiguous.map((p) => `« ${p.name} » (réf. ${p.reference})`).join(", ")} ?`], answered: 1, unanswered: 0 });
    } else if (m.offer_id && kinds.length === 1) {
      return null; // question sur la disponibilité des lignes de l'offre en cours : réponse habituelle
    } else if (kinds.length === 1) {
      parts.push({ lines: ["Bien sûr ! De quelle référence s'agit-il ? Envoyez-moi la référence, le code EAN ou le nom du produit et je vous dis tout de suite ce qu'il en est."], answered: 1, unanswered: 0 });
    } else kinds = kinds.filter((k) => k !== "stock"); // « dispo » dans une autre demande (ex. « ma facture est dispo ? »)
  }

  const orders = m.customer_id
    ? (await db.query<{ id: string; number: string; status: string; created_at: string; total_ht: string; total_ttc: string; lines: { reference: string; description: string; quantity: string; unit_price_ht: string; line_total_ht: string }[] }>(
        `select id, number, status, created_at::text, total_ht::text, total_ttc::text, lines from order_requests where customer_id = $1 and organization_id = $2 and status <> 'cancelled' order by created_at desc limit 20`,
        [m.customer_id, orgId])).rows
    : [];
  const order = orders.find((o) => norm(m.body).includes(norm(o.number))) ?? orders[0] ?? null;

  if (kinds.includes("order_status")) {
    if (order)
      parts.push({
        lines: [`Votre commande du ${dateFr(order.created_at)} (${order.number}, ${formatMoney(order.total_ht)} HT) est bien enregistrée${order.status === "sent_to_erp" ? " et transmise à notre logistique" : order.status === "confirmed" ? " et confirmée" : ""}. Je n'ai pas encore la date de livraison : je la vérifie avec votre commercial et je reviens vers vous très vite.`],
        answered: 1, unanswered: 1, tasks: [{ title: `Date de livraison à confirmer (${order.number})`, notes: m.body.slice(0, 500) }],
      });
    else parts.push({ lines: ["Je ne retrouve pas de commande récente à votre nom de mon côté : je vérifie avec votre commercial et je reviens vers vous très vite."], answered: 0, unanswered: 1, tasks: [{ title: "Suivi de commande demandé par le client", notes: m.body.slice(0, 500) }] });
  }

  if (kinds.includes("order_form")) {
    if (order) parts.push({ lines: [`Voici votre bon de commande ${order.number} du ${dateFr(order.created_at)} (${formatMoney(order.total_ht)} HT).`], docs: [await orderFormPdf(db, orgId, order, m.customer_name ?? "")], answered: 1, unanswered: 0 });
    else parts.push({ lines: ["Je ne retrouve pas de bon de commande à votre nom : je vérifie avec votre commercial et je vous l'envoie très vite."], answered: 0, unanswered: 1, tasks: [{ title: "Bon de commande demandé par le client", notes: m.body.slice(0, 500) }] });
  }

  if (kinds.includes("invoice")) {
    const invoices = m.customer_id
      ? (await db.query<{ id: string; invoice_number: string; invoice_date: string; total_ttc: string; doc: string | null; doc_name: string | null; doc_mime: string | null }>(
          `select i.id, i.invoice_number, i.invoice_date::text, i.total_ttc::text, d.storage_path as doc, d.name as doc_name, d.mime_type as doc_mime
           from invoices i left join lateral (select storage_path, name, mime_type from documents where organization_id = i.organization_id and owner_type = 'invoice' and owner_id = i.id order by created_at desc limit 1) d on true
           where i.customer_id = $1 and i.organization_id = $2 and i.doc_type = 'invoice' and i.status = 'issued' order by i.invoice_date desc, i.created_at desc limit 50`, [m.customer_id, orgId])).rows
      : [];
    const inv = invoices.find((i) => norm(m.body).includes(norm(i.invoice_number))) ?? invoices[0] ?? null;
    const label = inv ? `n° ${inv.invoice_number} du ${dateFr(inv.invoice_date)} (${formatMoney(inv.total_ttc)} TTC)` : "";
    if (inv?.doc) parts.push({ lines: [`Voici votre facture ${label}.`], docs: [{ filename: inv.doc_name ?? `Facture-${inv.invoice_number}.pdf`, storagePath: inv.doc, mimeType: inv.doc_mime ?? "application/pdf" }], answered: 1, unanswered: 0 });
    else if (inv) parts.push({ lines: [`Je demande une copie de votre facture ${label} à notre comptabilité : vous la recevez très vite.`], answered: 1, unanswered: 1, tasks: [{ title: `Envoyer la facture ${inv.invoice_number} au client`, notes: "La facture PDF n'est pas disponible dans LÉA.AI : l'envoyer depuis l'ERP." }] });
    else parts.push({ lines: ["Je ne retrouve pas de facture à votre nom de mon côté : je vérifie avec notre comptabilité et je reviens vers vous très vite."], answered: 0, unanswered: 1, tasks: [{ title: "Facture demandée par le client", notes: m.body.slice(0, 500) }] });
  }
  if (!parts.length) return null;

  // Rédaction : réponse d'une commerciale (bonjour si le client salue ou premier échange, merci, faits, question utile). Pas de signature WhatsApp en discussion.
  const settings = (await db.query<{ brand_voice: unknown; company: string | null; name: string }>(
    `select s.brand_voice, s.brand->>'companyName' as company, o.name from organization_settings s join organizations o on o.id = s.organization_id where s.organization_id = $1`, [orgId])).rows[0];
  const v = parseVoice(settings?.brand_voice);
  const companyName = settings?.company ?? settings?.name ?? "";
  const wa = m.channel === "whatsapp";
  const turn = Number((await db.query<{ n: string }>(`select count(*) n from messages where conversation_id = $1 and direction = 'outbound' and status in ('sent','simulated_sent')`, [m.conversation_id])).rows[0]!.n);
  const greeted = /^\s*(bonjour|bonsoir|salut|hello|coucou|bjr)\b/i.test(m.body);
  const hello = greeting({ salutation: m.salutation, firstName: m.first_name, lastName: m.last_name });
  const lines = parts.flatMap((p) => p.lines);
  const close = parts.map((p) => p.close).find(Boolean) ?? null;
  const body = wa
    ? [greeted || turn === 0 ? `${hello.replace(/,$/, " !")}${emoji(v, "whatsapp", "👋")}` : null, `Merci pour votre message${emoji(v, "whatsapp", "🙏")}`, ...lines, close].filter((x): x is string => !!x).join("\n")
    : [hello, "", "Merci pour votre message.", "", ...lines, ...(close ? ["", close] : []), ...signoff(v, "", companyName, "email")].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const docs = parts.flatMap((p) => p.docs ?? []);
  const answered = parts.reduce((a, p) => a + p.answered, 0);
  const unanswered = parts.reduce((a, p) => a + p.unanswered, 0);

  const cfg = await loadAutonomy(db, orgId);
  const decision = decideAutonomy(cfg, { kind: "reply", intent: "question", objection: null, escalate: false, discountPct: null, answered, unanswered, guardNotes: [], identityVerified: m.identity === "verified", injectionSuspected: false });
  const automatic = decision.mode === "auto";
  const id = (await db.query<{ id: string }>(
    `insert into messages (organization_id, conversation_id, direction, channel, to_address, subject, body, status, ai_generated, ai_analysis)
     values ($1,$2,'outbound',$3,$4,$5,$6,$7,true,$8) returning id`,
    [orgId, m.conversation_id, m.channel, m.from_address, wa ? null : "RE: Votre demande", body, automatic ? "approved" : "pending_approval",
      { kind: "service_reply", requests: kinds, autonomy: decision, attachDocs: docs }])).rows[0]!.id;
  await db.query(`update messages set handled = true where id = $1`, [inboundId]);
  if (!automatic)
    await db.query(`insert into approvals (organization_id, subject_type, subject_id, summary, payload, requested_by_agent) values ($1,'message',$2,$3,$4,true)
                    on conflict (organization_id, subject_type, subject_id) where status = 'pending' do nothing`,
      [orgId, id, `Réponse service client — ${m.customer_name ?? "client"}`, { conversationId: m.conversation_id, reason: decision.reason }]);
  for (const [i, t] of parts.flatMap((p) => p.tasks ?? []).entries()) {
    if (!m.customer_id) break;
    await db.query(
      `insert into followup_tasks (organization_id, customer_id, conversation_id, offer_id, kind, title, due_at, assigned_user_id, idempotency_key, notes, created_by_agent)
       select $1, $2, $3, $4, 'reply', $5, now() + interval '4 hours', cu.owner_user_id, $6, $7, true from customers cu where cu.id = $2
       on conflict (organization_id, idempotency_key) do nothing`,
      [orgId, m.customer_id, m.conversation_id, m.offer_id, `${t.title} — ${m.customer_name ?? ""}`, `service:${inboundId}:${i}`, t.notes]);
  }
  await audit(db, orgId, { type: "agent" }, "lea.service_reply", { type: "message", id }, { requests: kinds, documents: docs.length, automatic });
  const dispatch = automatic ? await dispatchMessage(db, orgId, id, { type: "agent" }, { autonomous: true, now: opts.now }) : null;
  return { kinds, replyMessageId: id, decision, dispatch, summary: `Service client : ${kinds.join(", ")}${docs.length ? ` (${docs.length} document(s))` : ""}` };
}
