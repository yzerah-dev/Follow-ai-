# Intégrations

Chaque canal est un `ChannelAdapter` (`lib/integrations/`) déclarant fonctions et limites, affichées dans *Connexions*.
États : non connectée · configuration nécessaire · connectée · erreur · autorisation expirée. Une simulation n'est jamais « connectée ».

| Canal | Adaptateur | État actuel | À fournir pour activer |
|---|---|---|---|
| Email (simulation) | `SimulatedEmailAdapter` | ✅ opérationnel, aucun envoi réel | — |
| Gmail | `email:gmail` | configuration nécessaire | Projet Google Cloud, écran de consentement OAuth, scopes `gmail.readonly` `gmail.send`, URL de redirection ; jetons chiffrés dans `connection_secrets` |
| Microsoft 365 | `email:microsoft365` | configuration nécessaire | App Entra ID, permissions `Mail.Read` `Mail.Send` |
| WhatsApp | `whatsapp:whatsapp_cloud` | non connectée | Compte WhatsApp Business Platform (Meta), numéro vérifié, modèles approuvés, consentement, fenêtre 24 h |
| LinkedIn | `linkedin:linkedin` | non connectée | Produits API accordés à l'application ; la messagerie n'étant pas ouverte, **workflow manuel** : LÉA prépare, le commercial envoie |
| SMS | `sms:sms_provider` | non connectée | Fournisseur SMS pro, expéditeur, gestion STOP |
| Téléphone | `phone:telephony` | non connectée | Fournisseur téléphonie. Appels autonomes **désactivés** (MVP). Transcription seulement si légale et consentie |

## Réception d'emails
`POST /api/webhooks/email` : JSON `{ organizationId, from, subject, body, providerMessageId }`, en-tête
`X-Follow-Signature: t=<unix>,v1=<hmac_sha256(secret, "t.body")>` (`WEBHOOK_SIGNING_SECRET`). Idempotent, identification du contact
par email exact (identité « probable » si le contact appartient à plusieurs sociétés), puis analyse par LÉA.

## IA
- Claude : `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `LLM_MODEL` (défaut `claude-opus-5-5`). Non testé ici faute de clé.
- Images : désactivé. ChatGPT Work : désactivé (aucune intégration officielle vérifiée).
