import crypto from "node:crypto";
import { NotConfiguredError, type Channel, type ChannelAdapter, type OutboundMessage, type SendResult } from "./types";

/** Email SIMULÉ : aucun envoi réel, trace complète. Utilisé en démo et dans les tests. */
export class SimulatedEmailAdapter implements ChannelAdapter {
  readonly channel = "email" as const;
  readonly provider = "simulated";
  readonly simulated = true;
  readonly capabilities = ["Brouillons", "Envoi simulé (aucun email ne quitte la plateforme)", "Réponses simulées", "Historique"];
  readonly limitations = ["Aucun message n'est réellement transmis au client."];
  readonly outbox: OutboundMessage[] = [];
  async send(msg: OutboundMessage): Promise<SendResult> {
    this.outbox.push(msg);
    return { providerMessageId: `sim-${crypto.randomUUID()}`, simulated: true };
  }
}

/** Adaptateurs officiels prévus — non configurés tant que les autorisations OAuth / API ne sont pas fournies. */
class PendingAdapter implements ChannelAdapter {
  readonly simulated = false;
  constructor(readonly channel: Channel, readonly provider: string, readonly capabilities: string[], readonly limitations: string[]) {}
  async send(): Promise<SendResult> {
    throw new NotConfiguredError(this.provider);
  }
}

export const ADAPTERS: Record<string, ChannelAdapter> = {
  "email:simulated": new SimulatedEmailAdapter(),
  "email:gmail": new PendingAdapter("email", "gmail", ["Lecture des messages autorisés (Gmail API)", "Brouillons", "Envoi après validation", "Réception des réponses"], ["Nécessite un projet Google Cloud, l'écran de consentement OAuth et les scopes gmail.readonly / gmail.send."]),
  "email:microsoft365": new PendingAdapter("email", "microsoft365", ["Lecture des messages autorisés (Microsoft Graph)", "Brouillons", "Envoi après validation"], ["Nécessite une application Entra ID et les permissions Mail.Read / Mail.Send."]),
  "whatsapp:whatsapp_cloud": new PendingAdapter("whatsapp", "whatsapp_cloud", ["Messages", "Documents", "Images", "Modèles de messages approuvés"], ["Plateforme WhatsApp Business officielle (Meta) : consentement préalable, modèles approuvés hors fenêtre de 24 h."]),
  "linkedin:linkedin": new PendingAdapter("linkedin", "linkedin", ["Partage de contenu selon les produits API accordés"], ["La messagerie LinkedIn n'est pas ouverte aux applications standard : workflow manuel proposé (LÉA prépare le message, le commercial l'envoie depuis LinkedIn)."]),
  "sms:sms_provider": new PendingAdapter("sms", "sms_provider", ["Envoi", "Réception", "Désinscription STOP", "Historique"], ["Nécessite un fournisseur SMS professionnel et un expéditeur déclaré."]),
  "phone:telephony": new PendingAdapter("phone", "telephony", ["Journal d'appels", "Résumés (prévu)", "Transfert humain (prévu)"], ["Appels autonomes désactivés dans le MVP. Transcription uniquement si légalement autorisée et consentie."]),
};

export function adapterFor(channel: Channel, provider: string): ChannelAdapter | null {
  return ADAPTERS[`${channel}:${provider}`] ?? null;
}
