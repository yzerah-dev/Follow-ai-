# Intégrations

Chaque canal est un `ChannelAdapter` (`lib/integrations/`) déclarant fonctions et limites, affichées dans *Connexions*.
États : non connectée · configuration nécessaire · connectée · erreur · autorisation expirée. Une simulation n'est jamais « connectée ».

| Canal | Adaptateur | État actuel | À fournir pour activer |
|---|---|---|---|
| Email (simulation) | `SimulatedEmailAdapter` | ✅ opérationnel, aucun envoi réel | — |
| Gmail | `email:gmail` | configuration nécessaire | Projet Google Cloud, écran de consentement OAuth, scopes `gmail.readonly` `gmail.send`, URL de redirection ; jetons chiffrés dans `connection_secrets` |
| Microsoft 365 | `email:microsoft365` | configuration nécessaire | App Entra ID, permissions `Mail.Read` `Mail.Send` |
| WhatsApp (simulation) | `SimulatedWhatsAppAdapter` | ✅ opérationnel, aucun envoi réel — mêmes règles que le réel (24 h, modèles, consentement) | — |
| WhatsApp | `WhatsAppCloudAdapter` (`lib/integrations/whatsapp-cloud.ts`) | écrit d'après l'API Cloud de Meta, **non testé contre Meta** | Compte WhatsApp Business Platform, numéro vérifié (`phoneNumberId` dans la connexion), jeton d'accès (chiffré dans `connection_secrets`), modèles approuvés, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` |
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

## WhatsApp
- **Choix du canal** : email si le contact y a consenti ; sinon WhatsApp (mobile + `consent_whatsapp`).
- **Fenêtre de 24 h** : message libre seulement dans les 24 h qui suivent le dernier message du client ; sinon modèle approuvé.
  L'interface l'indique (« Fenêtre ouverte jusqu'à … ») et bloque la saisie humaine hors fenêtre.
- **Modèles à faire approuver par Meta** (catégorie *utility*, langue `fr`), textes exacts dans `features/conversations/templates.ts` :
  `offre_disponible` (en-tête document : PDF de l'offre) et `relance_offre`. Les variables sont remplies par le système, jamais par l'IA.
- **Webhook** : `GET /api/webhooks/whatsapp` (vérification `hub.verify_token`) et `POST` (signature `X-Hub-Signature-256` avec le secret
  de l'application). Le `phone_number_id` identifie l'organisation ; messages idempotents (`wamid`), « STOP » → liste d'opposition WhatsApp.
- **Pièces jointes** : PDF de l'offre uniquement (l'Excel reste réservé à l'email).
