# Décisions d'architecture

| # | Décision | Raison |
|---|---|---|
| D1 | Accès données via `pg` + `set local role authenticated` + `request.jwt.claims` plutôt que le client Supabase JS | Même mécanisme que PostgREST : la RLS est la barrière finale, testable sur PostgreSQL local identique ; requêtes SQL explicites |
| D2 | Shim Supabase local (`supabase/local`) | Exécuter migrations et tests RLS sans Docker ni projet distant |
| D3 | Claims agent `agent_org` | Les jobs asynchrones sont soumis à la RLS d'une seule organisation ; jamais combinables avec un utilisateur |
| D4 | Auth locale (bcrypt pgcrypto + JWT jose) en V1 ; adaptateur Supabase Auth plus tard | Démarrage sans service externe ; format de mot de passe compatible GoTrue |
| D5 | Inngest retiré temporairement | `inngest@4` dépend de `zod@3` (avis GHSA-mrhx-c7xc-m3w5). Remplacé par `after()` + Vercel Cron idempotent ; services prêts à être appelés depuis Inngest |
| D6 | XLS non pris en charge | Le paquet `xlsx` npm n'est plus maintenu et présente des vulnérabilités ; ExcelJS pour XLSX |
| D7 | pdf-lib (polices standard) pour le PDF | Composition contrôlée, sans navigateur côté serveur ; caractères hors WinAnsi remplacés |
| D8 | IA simulée déterministe par défaut | Ne pas bloquer le projet sans clé ; mêmes schémas que Claude ; signalée dans l'interface |
| D9 | SDK Anthropic officiel, `claude-opus-5-5`, effort bas, repli serveur `fallbacks: "default"` | Sorties structurées validées ; refus gérés ; coût suivi par exécution |
| D10 | Décisions financières déterministes, IA limitée au texte | Jamais de remise, prix ou stock décidés par le modèle |
| D11 | Composants UI façon shadcn écrits à la main (Radix + cva) | La CLI shadcn nécessite un accès réseau au registre ; `components.json` conservé pour la compatibilité |
| D12 | Next.js 16 (`proxy.ts`), TypeScript 5.9 (et non 7.x) | Versions stables compatibles avec la chaîne Next/ESLint |
| D13 | `.npmrc legacy-peer-deps` | Conflit de peers `vitest` ↔ `@vitest/browser-playwright` (non utilisé) |
| D14 | Playwright 1.63 | Version alignée sur le navigateur préinstallé |
| D15 | Rate limit en mémoire | Suffisant en instance unique ; Redis à brancher en multi-instance |
| D16 | Autonomie de LÉA par règles déterministes, sans approbation « auto-décidée » | L'agent ne décide jamais une approbation (RLS inchangée) : un envoi autorisé ne crée simplement pas de demande ; décision et raison tracées dans `agent_decisions` |
| D17 | Envoi unique via `dispatchMessage` | Mêmes contrôles (opposition, consentement, connexion) pour humain et agent ; plage horaire et quota pour l'autonome |
| D18 | Interrupteur via fonction `security definer` réservée aux managers | Un manager peut arrêter LÉA sans pouvoir modifier toute la politique |
| D19 | Pas de validation humaine obligatoire des envois en V1 (décision client 2026-11-08) | JONAS autonome ; la validation reste un choix par organisation (mode supervisé) et s'applique toujours aux cas sensibles listés dans `autonomy.ts` |
| D20 | Direction artistique violette, graphiques SVG faits main | Pas de dépendance graphique ; palette catégorielle validée (#6e44ff, #e0821b, #1f8fb8, #c2407e) ; légende avec valeurs, info-bulles, un seul axe |
| D21 | LÉA illustrée (SVG stylisé), clients en initiales | Aucune photo de personne réelle ni logo de marque tiers sans licence ; un visuel sous licence peut être fourni (`public/lea.png`) |
| D22 | « Permanent » dans la répartition du CA = couple client × produit facturé au moins 3 fois | Règle simple et déterministe, affichée sous le graphique ; distincte du critère de cycle régulier de la mission 2 |
| D23 | Voix de LÉA = forme uniquement (`brand_voice`) | Ton, longueur, emojis, présentation ; le fond (prix, stock, remises, arguments) reste calculé par le système |
| D24 | Arguments commerciaux seulement s'ils sont vérifiés par les données, agrégés (≥ 5 acheteurs), sans « % » | Pas d'allégation trompeuse ; aucun autre client identifiable ; le « % » reste réservé aux remises contrôlées par les garde-fous |
| D25 | Pas d'argument « marge » tant qu'aucun prix de vente conseillé n'est importé | Une marge client ne peut pas être affirmée sans PVC ; prix d'achat et marges internes jamais communiqués |
| D26 | Consentement des clients existants déclaré par l'entreprise, audité | L'entreprise porte la responsabilité de la déclaration ; STOP / opposition prioritaires ; modèles Meta obligatoires hors 24 h |
| D27 | Couverture de stock estimée à partir des achats (sell-in), hypothèses H1/H2 affichées | Les factures ne mesurent pas les ventes consommateur ; une estimation est toujours étiquetée et remplacée par la donnée déclarée quand elle existe |
| D28 | Offre révisée = nouvelle offre, l'ancienne « remplacée » | Traçabilité des versions et de l'attribution ; la conversation suit la dernière version ; une acceptation porte sur l'offre révisée |
| D29 | Révision jamais plus chère sur objection prix, 2 révisions maximum | Ne pas mettre le client en difficulté ni le harceler ; au-delà, le commercial reprend |
