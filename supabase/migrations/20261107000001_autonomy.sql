-- =====================================================================
-- Follow.AI — Mode autonome de LÉA
-- LÉA peut envoyer seule ce qui respecte la politique de l'organisation.
-- Invariant conservé : l'agent ne DÉCIDE jamais une demande d'approbation ;
-- un envoi autonome ne crée simplement pas de demande (décision tracée dans agent_decisions).
-- =====================================================================

alter table public.organization_settings
  add column autonomy_level text not null default 'supervised'
    check (autonomy_level in ('supervised', 'semi_autonomous', 'autonomous')),
  add column autonomy_paused boolean not null default false,            -- interrupteur d'arrêt
  add column autonomous_max_offer_ht numeric(14,2) check (autonomous_max_offer_ht >= 0), -- au-delà : validation
  add column daily_send_limit integer not null default 200 check (daily_send_limit between 0 and 10000),
  add column daily_offer_limit integer not null default 20 check (daily_offer_limit between 0 and 1000),
  add column send_window jsonb not null default '{"days":[1,2,3,4,5],"start":"08:30","end":"18:30"}'::jsonb,
  add column followup_after_days integer not null default 5 check (followup_after_days between 1 and 60),
  add column max_followups integer not null default 2 check (max_followups between 0 and 10);

-- Envoi programmé (hors plage horaire, quota atteint) et traçabilité de l'autonomie
alter table public.messages
  add column scheduled_at timestamptz,
  add column sent_autonomously boolean not null default false;
create index messages_due_idx on public.messages (organization_id, scheduled_at) where status = 'approved';

-- Relances : compteur pour limiter le nombre de relances successives
alter table public.followup_tasks
  add column attempt integer not null default 1 check (attempt >= 1);
