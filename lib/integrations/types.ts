export type Channel = "email" | "whatsapp" | "linkedin" | "sms" | "phone";

/** Modèle de message pré-approuvé (WhatsApp : obligatoire hors fenêtre de 24 h). */
export type MessageTemplate = { name: string; language: string; params: string[] };

export type OutboundMessage = {
  organizationId: string;
  messageId: string;
  channel: Channel;
  to: string; // email ou numéro E.164
  subject: string | null;
  body: string;
  template: MessageTemplate | null;
  attachments: { filename: string; storagePath: string; mimeType: string }[];
};

export type SendResult = { providerMessageId: string; simulated: boolean };

export interface ChannelAdapter {
  readonly channel: Channel;
  readonly provider: string;
  readonly simulated: boolean;
  /** Ce que l'intégration permet réellement (affiché dans Connexions). */
  readonly capabilities: string[];
  readonly limitations: string[];
  send(msg: OutboundMessage): Promise<SendResult>;
}

export class NotConfiguredError extends Error {
  constructor(provider: string) {
    super(`Le connecteur « ${provider} » n'est pas configuré : aucun envoi n'a été effectué.`);
  }
}
