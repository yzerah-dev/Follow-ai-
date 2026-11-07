/**
 * Connecteur officiel WhatsApp Business Platform (Cloud API de Meta).
 * Implémenté d'après l'API publique (POST /{phone-number-id}/messages) — NON TESTÉ contre Meta faute de compte.
 * Règles appliquées en amont (dispatch) : consentement, fenêtre de 24 h (sinon modèle approuvé), liste d'opposition.
 */
import crypto from "node:crypto";
import { getFile } from "@/lib/storage";
import type { ChannelAdapter, OutboundMessage, SendResult } from "./types";

export const GRAPH_VERSION = "v21.0";

export type WhatsAppCloudConfig = { phoneNumberId: string; accessToken: string; graphBase?: string };

type Fetch = typeof fetch;

export class WhatsAppCloudAdapter implements ChannelAdapter {
  readonly channel = "whatsapp" as const;
  readonly provider = "whatsapp_cloud";
  readonly simulated = false;
  readonly capabilities = ["Messages texte dans la fenêtre de 24 h", "Modèles approuvés hors fenêtre", "Documents (PDF de l'offre)", "Réception des réponses (webhook)"];
  readonly limitations = ["Compte WhatsApp Business Platform, numéro vérifié et modèles approuvés par Meta requis. Consentement préalable du contact obligatoire."];

  constructor(private cfg: WhatsAppCloudConfig, private http: Fetch = fetch) {}

  private url(path: string) {
    return `${this.cfg.graphBase ?? "https://graph.facebook.com"}/${GRAPH_VERSION}/${this.cfg.phoneNumberId}/${path}`;
  }

  private async call(path: string, body: unknown): Promise<{ messages?: { id: string }[]; id?: string }> {
    const res = await this.http(this.url(path), {
      method: "POST",
      headers: { Authorization: `Bearer ${this.cfg.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`WhatsApp Cloud API : erreur ${res.status}`);
    return res.json() as Promise<{ messages?: { id: string }[]; id?: string }>;
  }

  /** Construit la charge utile (exportée pour les tests). */
  static payload(msg: OutboundMessage, mediaId?: string) {
    const to = msg.to.replace(/^\+/, "");
    if (msg.template) {
      return {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: msg.template.name,
          language: { code: msg.template.language },
          components: [
            ...(mediaId ? [{ type: "header", parameters: [{ type: "document", document: { id: mediaId, filename: msg.attachments[0]?.filename } }] }] : []),
            { type: "body", parameters: msg.template.params.map((text) => ({ type: "text", text })) },
          ],
        },
      };
    }
    return { messaging_product: "whatsapp", to, type: "text", text: { preview_url: false, body: msg.body.slice(0, 4096) } };
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    let mediaId: string | undefined;
    const doc = msg.attachments.find((a) => a.mimeType === "application/pdf");
    if (doc && msg.template) {
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("file", new Blob([new Uint8Array(await getFile(doc.storagePath))], { type: "application/pdf" }), doc.filename);
      const res = await this.http(this.url("media"), { method: "POST", headers: { Authorization: `Bearer ${this.cfg.accessToken}` }, body: form });
      if (!res.ok) throw new Error(`WhatsApp Cloud API (média) : erreur ${res.status}`);
      mediaId = ((await res.json()) as { id: string }).id;
    }
    const r = await this.call("messages", WhatsAppCloudAdapter.payload(msg, mediaId));
    const id = r.messages?.[0]?.id;
    if (!id) throw new Error("WhatsApp Cloud API : identifiant de message manquant.");
    return { providerMessageId: id, simulated: false };
  }
}

/** Vérifie l'en-tête X-Hub-Signature-256 envoyé par Meta (HMAC-SHA256 du corps brut avec le secret de l'application). */
export function verifyMetaSignature(appSecret: string, rawBody: string, header: string | null): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(header.slice(7), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type InboundWhatsApp = { phoneNumberId: string; from: string; providerMessageId: string; body: string; timestamp: string; profileName: string | null };

/** Extrait les messages entrants d'un webhook WhatsApp (ignore les accusés de lecture/livraison). */
export function parseWhatsAppWebhook(payload: unknown): InboundWhatsApp[] {
  const out: InboundWhatsApp[] = [];
  const p = payload as { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string }; contacts?: { profile?: { name?: string } }[]; messages?: { from?: string; id?: string; timestamp?: string; type?: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string } } }[] } }[] }[] };
  for (const e of p.entry ?? [])
    for (const c of e.changes ?? []) {
      const v = c.value;
      const pid = v?.metadata?.phone_number_id;
      if (!pid) continue;
      for (const m of v.messages ?? []) {
        const body = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? (m.type ? `[${m.type} reçu — non pris en charge]` : "");
        if (!m.from || !m.id) continue;
        out.push({ phoneNumberId: pid, from: m.from, providerMessageId: m.id, body, timestamp: m.timestamp ?? "", profileName: v.contacts?.[0]?.profile?.name ?? null });
      }
    }
  return out;
}
