/**
 * Connecteur officiel WhatsApp Business Platform (Cloud API de Meta).
 * Implémenté d'après l'API publique (POST /{phone-number-id}/messages) — testé avec des réponses simulées, pas encore contre Meta.
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
  readonly capabilities = ["Messages texte dans la fenêtre de 24 h", "Modèles approuvés hors fenêtre", "Documents (PDF, Excel)", "Réception des réponses et des fichiers (webhook)"];
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

  private async upload(doc: { filename: string; storagePath: string; mimeType: string }): Promise<string> {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", doc.mimeType);
    form.append("file", new Blob([new Uint8Array(await getFile(doc.storagePath))], { type: doc.mimeType }), doc.filename);
    const res = await this.http(this.url("media"), { method: "POST", headers: { Authorization: `Bearer ${this.cfg.accessToken}` }, body: form });
    if (!res.ok) throw new Error(`WhatsApp Cloud API (média) : erreur ${res.status}`);
    return ((await res.json()) as { id: string }).id;
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    const doc = msg.attachments[0];
    const mediaId = doc ? await this.upload(doc) : undefined;
    // Modèle : le document est l'en-tête du modèle. Message libre : le texte, puis le document dans un second message.
    const r = await this.call("messages", WhatsAppCloudAdapter.payload(msg, msg.template ? mediaId : undefined));
    const id = r.messages?.[0]?.id;
    if (!id) throw new Error("WhatsApp Cloud API : identifiant de message manquant.");
    if (doc && mediaId && !msg.template)
      await this.call("messages", { messaging_product: "whatsapp", to: msg.to.replace(/^\+/, ""), type: "document", document: { id: mediaId, filename: doc.filename } });
    return { providerMessageId: id, simulated: false };
  }

  /** Télécharge un fichier reçu (document envoyé par le client) : URL temporaire puis contenu, avec le jeton du numéro. */
  async downloadMedia(mediaId: string, maxBytes: number): Promise<{ data: Buffer; mimeType: string }> {
    if (!/^[0-9]{1,40}$/.test(mediaId)) throw new Error("Identifiant de média invalide.");
    const meta = await this.http(`${this.cfg.graphBase ?? "https://graph.facebook.com"}/${GRAPH_VERSION}/${mediaId}`, { headers: { Authorization: `Bearer ${this.cfg.accessToken}` } });
    if (!meta.ok) throw new Error(`WhatsApp Cloud API (média) : erreur ${meta.status}`);
    const info = (await meta.json()) as { url?: string; mime_type?: string; file_size?: number };
    if (!info.url) throw new Error("WhatsApp Cloud API : URL du média absente.");
    if (info.file_size && info.file_size > maxBytes) throw new Error("Fichier trop volumineux.");
    const file = await this.http(info.url, { headers: { Authorization: `Bearer ${this.cfg.accessToken}` } });
    if (!file.ok) throw new Error(`WhatsApp Cloud API (téléchargement) : erreur ${file.status}`);
    const data = Buffer.from(await file.arrayBuffer());
    if (data.length > maxBytes) throw new Error("Fichier trop volumineux.");
    return { data, mimeType: info.mime_type ?? "application/octet-stream" };
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

export type InboundWhatsApp = {
  phoneNumberId: string; from: string; providerMessageId: string; body: string; timestamp: string; profileName: string | null;
  /** Document joint par le client (ex. l'Excel de sa sélection avec ses quantités). */
  document: { mediaId: string; filename: string; mimeType: string | null } | null;
};

/** Extrait les messages entrants d'un webhook WhatsApp (ignore les accusés de lecture/livraison). */
export function parseWhatsAppWebhook(payload: unknown): InboundWhatsApp[] {
  const out: InboundWhatsApp[] = [];
  const p = payload as { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string }; contacts?: { profile?: { name?: string } }[]; messages?: { from?: string; id?: string; timestamp?: string; type?: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string } }; document?: { id?: string; filename?: string; mime_type?: string; caption?: string } }[] } }[] }[] };
  for (const e of p.entry ?? [])
    for (const c of e.changes ?? []) {
      const v = c.value;
      const pid = v?.metadata?.phone_number_id;
      if (!pid) continue;
      for (const m of v.messages ?? []) {
        const doc = m.type === "document" && m.document?.id ? { mediaId: m.document.id, filename: (m.document.filename ?? "document").slice(0, 200), mimeType: m.document.mime_type ?? null } : null;
        const body = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title
          ?? (doc ? (m.document?.caption?.trim() || `📎 ${doc.filename}`) : m.type ? `[${m.type} reçu — non pris en charge]` : "");
        if (!m.from || !m.id) continue;
        out.push({ phoneNumberId: pid, from: m.from, providerMessageId: m.id, body, timestamp: m.timestamp ?? "", profileName: v.contacts?.[0]?.profile?.name ?? null, document: doc });
      }
    }
  return out;
}
