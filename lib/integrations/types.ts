export type Channel = "email" | "whatsapp" | "linkedin" | "sms" | "phone";

export type OutboundMessage = {
  organizationId: string;
  messageId: string;
  to: string;
  subject: string | null;
  body: string;
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
