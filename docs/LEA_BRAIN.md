# Le cerveau de LÉA

## Les 6 missions permanentes (quotidiennes, pour chaque client)
| # | Mission | Détection déterministe | Action de LÉA |
|---|---|---|---|
| 1 | Réactivation | dernière facture vs fréquence habituelle (> max(seuil, 2,5 × cycle)) | offre personnalisée sur les références habituelles |
| 2 | Permanents | références achetées ≥ 3 fois, cycle ≤ 120 j, régulières (CV ≤ 0,6) ; échéance = dernier achat + cycle | offre de réassort, quantités habituelles arrondies au colis |
| 3 | Complémentaires & retours en stock | co-achats (lift ≥ 2) ; produit habituel redevenu disponible (relevé à 0 puis > 0 sur 45 j) | offre additionnelle / avertissement retour en stock |
| 4 | Nouveautés | nouveautés < 120 j dans les catégories ≥ 25 % des achats du client | offre découverte + **catalogue personnalisé** (studio créatif) |
| 5 | Rendez-vous | compte ≥ 10 k€/an non rencontré depuis `meeting_interval_days` (180 j), ou CA −30 % sur 90 j | invitation visio / showroom (ou tâche d'appel si préférence téléphone) ; argumentaire chiffré au commercial |
| 6 | Objectifs de CA | réalisé vs attendu à date (saisonnalité N-1 ou prorata), alerte au-delà de `target_alert_pct` | plan d'accélération chiffré par les leviers détectés, tâche « plan » au commercial |

Priorisation commune : **potentiel** (valeur estimée, log) × **urgence** (date conseillée / retard) × **probabilité** (confiance),
stockée dans `opportunities.details.scoring` ; mission dans `details.mission`. Sans valeur chiffrée : « À confirmer », potentiel neutre.
Garde-fous : anti-doublons (`dedupe_key`), une sollicitation proactive par client tous les `contact_cooldown_days` (7 j),
pause de `refusal_cooldown_days` (60 j) après un refus, « ne plus solliciter », préférence de canal, consentements, relances bornées.
En mode **supervisé** (au choix de chaque organisation), LÉA prépare chaque jour offres, supports, invitations et plans ; rien ne part sans validation humaine.

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
