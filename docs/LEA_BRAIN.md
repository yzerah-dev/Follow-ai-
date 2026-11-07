# Le cerveau de LÉA

## Cinq couches
1. **Perception** — lecture sous RLS des clients, factures et lignes, produits, tarifs, stocks, offres, conversations, campagnes.
2. **Mémoire** — `agent_memory` par organisation et par client, avec niveau de certitude (`verified_fact`, `declared`, `hypothesis`)
   et péremption (`valid_until`). Alimentée par les réponses clients (objections, demandes de remise, quantités, prix cibles)
   et les consignes des commerciaux. Aucune fuite possible entre organisations (RLS).
3. **Raisonnement** — `lib/ai` : adaptateur LLM à sorties structurées (Zod).
   - `anthropic` : API Claude officielle (`@anthropic-ai/sdk`, `messages.parse` + `betaZodOutputFormat`, modèle `LLM_MODEL`,
     défaut `claude-opus-5-5`, effort `low`, repli serveur `fallbacks: "default"` en cas de refus).
   - `mock` : cerveau déterministe (`features/agent/mock-brain.ts`), mêmes contrats, signalé « IA simulée ».
   Les calculs financiers et la conformité restent **déterministes** (moteur d'opportunités, construction d'offres, politique de remise).
4. **Planification** — `runAutopilot` (`features/agent/autopilot.ts`, cron quotidien ou bouton « Lancer LÉA maintenant ») :
   recalcul des opportunités → pour les meilleures (réassort, dormant, campagne ; quota d'offres/jour) : offre → PDF + Excel contrôlés
   et validés automatiquement si tous les contrôles passent → email → envoi ou programmation ; envoi des messages programmés
   (cron toutes les 15 min) ; relances des offres sans réponse (max 2 automatiques). Chaque étape est isolée (savepoint).
5. **Exécution contrôlée** — outils métier typés : créer une offre (`createOfferDraft`), générer des supports, rédiger un message,
   analyser une réponse, préparer une réponse, programmer une relance, escalader. Tout résultat sensible devient un **brouillon**
   + une **demande d'approbation**, sauf si les règles d'autonomie de l'organisation autorisent l'envoi direct
   (décision tracée dans `agent_decisions` : `auto_send`, `auto_reply`, `auto_followup`, `escalation`). Les emails autonomes
   sont signés « LÉA — assistante commerciale » (transparence sur l'usage de l'IA).

## Tâches IA (`features/agent/lea.ts`)
| Tâche | Entrée | Sortie | Garde-fous |
|---|---|---|---|
| `draft_offer_email` | offre, lignes, historique, contact | objet, corps, base de personnalisation | personnalisation seulement si ≥ 3 factures ; aucune remise non présente dans l'offre ; vouvoiement ; repli sur gabarit |
| `analyze_reply` | email entrant (encapsulé) | intention, objection, remise/quantité/prix cible | détection d'injection journalisée ; désinscription → liste d'opposition |
| `draft_objection_reply` | analyse + **décision déterministe** de remise | réponse | remise ≤ décision du système ; sinon repli ; escalade = tâche au commercial |
| `lea_chat` | question + faits | réponse + liens internes | liens filtrés (internes uniquement) |

Chaque exécution est tracée dans `agent_runs` (fournisseur, modèle, jetons, coût estimé) et `agent_decisions` (justification).

## Discussion (email et WhatsApp)
À chaque message du client : analyse (intention, objection, remise, quantités) → **faits vérifiés** (`answers.ts` : prix et colisage des
lignes citées, montant, validité, disponibilité connue, franco, minimum, conditions de paiement) → réponse rédigée avec l'**historique**
de la conversation (12 derniers messages, encapsulés comme données) et le style du canal (WhatsApp : court, sans formule répétée,
signé « — LÉA » ; email : formules complètes). Ce qui n'a pas de donnée fiable (délai de livraison, disponibilité inconnue…) n'est jamais
inventé : LÉA l'annonce au client et crée une tâche « Répondre » pour le commercial. Un humain peut répondre lui-même à tout moment
dans le fil (zone « Votre réponse »).

## Comportement commercial
Proactive, persuasive, chaleureuse, directe, orientée conversion ; vouvoiement ; propose une action concrète
(commande, visio, showroom, portail B2B) ; ne prétend jamais personnaliser sans données ; n'invente aucun fait.
