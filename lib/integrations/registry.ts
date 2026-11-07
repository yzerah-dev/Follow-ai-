import crypto from "node:crypto";
import { NotConfiguredError, type Channel, type ChannelAdapter, type OutboundMessage, type SendResult } from "./types";
import { WhatsAppCloudAdapter } from "./whatsapp-cloud";

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

/** WhatsApp SIMULÉ : mêmes règles que le vrai canal (24 h, modèles, consentement), aucun envoi réel. */
export class SimulatedWhatsAppAdapter implements ChannelAdapter {
  readonly channel = "whatsapp" as const;
  readonly provider = "simulated";
  readonly simulated = true;
  readonly capabilities = ["Discussion simulée", "Règle des 24 h et modèles appliqués comme en réel", "Historique"];
  readonly limitations = ["Aucun message n'est réellement transmis au client."];
  readonly outbox: OutboundMessage[] = [];
  async send(msg: OutboundMessage): Promise<SendResult> {
    this.outbox.push(msg);
    return { providerMessageId: `sim-wa-${crypto.randomUUID()}`, simulated: true };
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

const whatsappInfo = new WhatsAppCloudAdapter({ phoneNumberId: "", accessToken: "" });

export const ADAPTERS: Record<string, ChannelAdapter> = {
  "email:simulated": new SimulatedEmailAdapter(),
  "whatsapp:simulated": new SimulatedWhatsAppAdapter(),
  "email:gmail": new PendingAdapter("email", "gmail", ["Lecture des messages autorisés (Gmail API)", "Brouillons", "Envoi après validation", "Réception des réponses"], ["Nécessite un projet Google Cloud, l'écran de consentement OAuth et les scopes gmail.readonly / gmail.send."]),
  "email:microsoft365": new PendingAdapter("email", "microsoft365", ["Lecture des messages autorisés (Microsoft Graph)", "Brouillons", "Envoi après validation"], ["Nécessite une application Entra ID et les permissions Mail.Read / Mail.Send."]),
  "whatsapp:whatsapp_cloud": new PendingAdapter("whatsapp", "whatsapp_cloud", whatsappInfo.capabilities, whatsappInfo.limitations),
  "linkedin:linkedin": new PendingAdapter("linkedin", "linkedin", ["Partage de contenu selon les produits API accordés"], ["La messagerie LinkedIn n'est pas ouverte aux applications standard : workflow manuel proposé (LÉA prépare le message, le commercial l'envoie depuis LinkedIn)."]),
  "sms:sms_provider": new PendingAdapter("sms", "sms_provider", ["Envoi", "Réception", "Désinscription STOP", "Historique"], ["Nécessite un fournisseur SMS professionnel et un expéditeur déclaré."]),
  "phone:telephony": new PendingAdapter("phone", "telephony", ["Journal d'appels", "Résumés (prévu)", "Transfert humain (prévu)"], ["Appels autonomes désactivés dans le MVP. Transcription uniquement si légalement autorisée et consentie."]),
};

/**
 * Adaptateur utilisable pour une connexion. Les connecteurs réels reçoivent leurs identifiants déchiffrés
 * (jamais exposés au client) ; sans identifiants, ils restent « non configurés ».
 */
export function adapterFor(channel: Channel, provider: string, secret?: Record<string, string> | null, config?: Record<string, unknown>): ChannelAdapter | null {
  if (channel === "whatsapp" && provider === "whatsapp_cloud" && secret?.accessToken && typeof config?.phoneNumberId === "string")
    return new WhatsAppCloudAdapter({ phoneNumberId: config.phoneNumberId, accessToken: secret.accessToken });
  return ADAPTERS[`${channel}:${provider}`] ?? null;
}
