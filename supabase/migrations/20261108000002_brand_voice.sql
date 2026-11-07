-- Voix de LÉA (ton, présentation, longueur, emojis, consignes de style) et canaux de contact par organisation.
alter table public.organization_settings
  add column brand_voice jsonb not null default '{}'::jsonb,
  -- canal privilégié quand le contact n'a pas exprimé de préférence (dans la limite des consentements)
  add column default_channel text not null default 'email' check (default_channel in ('email', 'whatsapp')),
  -- canal de chaque relance (1re, 2e…) ; vide = même canal que l'offre
  add column followup_channels text[] not null default '{}'
    check (followup_channels <@ array['email', 'whatsapp']::text[]);

