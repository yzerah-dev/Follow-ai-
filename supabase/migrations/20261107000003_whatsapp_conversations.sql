-- =====================================================================
-- Follow.AI — WhatsApp et discussions multicanales
-- =====================================================================
-- Dernier message reçu du client : fenêtre de service de 24 h (règle WhatsApp Business).
alter table public.conversations add column last_inbound_at timestamptz;
update public.conversations c set last_inbound_at = (
  select max(coalesce(m.received_at, m.created_at)) from public.messages m where m.conversation_id = c.id and m.direction = 'inbound');

-- Numéros normalisés E.164 pour identifier l'expéditeur WhatsApp / SMS.
create index contacts_org_mobile_idx on public.contacts (organization_id, mobile) where mobile is not null;
create index conversations_org_channel_idx on public.conversations (organization_id, channel, last_message_at desc);
