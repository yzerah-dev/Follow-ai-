import { Mail, MessageCircle, Briefcase, Smartphone, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

export const CHANNEL_LABEL: Record<string, string> = { email: "Email", whatsapp: "WhatsApp", linkedin: "LinkedIn", sms: "SMS", phone: "Téléphone" };

const ICONS = { email: Mail, whatsapp: MessageCircle, linkedin: Briefcase, sms: Smartphone, phone: Phone } as const;
const COLORS: Record<string, string> = {
  email: "text-info bg-info-soft",
  whatsapp: "text-[#128C7E] bg-[#E7F8EE]",
  linkedin: "text-[#0A66C2] bg-[#E8F1FB]",
  sms: "text-subtle bg-muted",
  phone: "text-subtle bg-muted",
};

export function ChannelIcon({ channel, size = 16, boxed = false }: { channel: string; size?: number; boxed?: boolean }) {
  const Icon = ICONS[channel as keyof typeof ICONS] ?? Mail;
  const color = COLORS[channel] ?? "text-subtle bg-muted";
  if (!boxed) return <Icon className={cn(color.split(" ")[0])} style={{ width: size, height: size }} aria-label={CHANNEL_LABEL[channel]} />;
  return (
    <span className={cn("mt-0.5 flex shrink-0 items-center justify-center rounded-md p-1.5", color)} title={CHANNEL_LABEL[channel]}>
      <Icon style={{ width: size, height: size }} aria-label={CHANNEL_LABEL[channel]} />
    </span>
  );
}
