# Mise en ligne de test + vrai WhatsApp (mode test)

Objectif : écrire à LÉA depuis votre téléphone sur WhatsApp et recevoir ses réponses.
Données : celles de démonstration (fictives). **Mode test** : LÉA n'écrit pour de vrai qu'aux numéros que vous autorisez,
toutes les autres conversations restent simulées. Aucun client réel n'est contacté.

Hébergeur retenu : **Railway** (l'application tourne comme un serveur classique, avec un disque pour les PDF/Excel et une base
PostgreSQL standard — exactement la configuration testée). Vercel demanderait d'abord un stockage de fichiers externe (voir `DEPLOYMENT.md`).
Coût : offre payante d'entrée de Railway (de l'ordre de 5 $ par mois au moment de l'écriture — à vérifier sur leur site).

---

## Étape 1 — Railway : l'application en ligne (≈ 15 min)

1. Créez un compte sur **railway.com** (connexion avec le compte GitHub qui a accès au dépôt `yzerah-dev/Follow-ai-`).
2. **New Project → Deploy from GitHub repo** → choisissez `Follow-ai-`. Dans le service créé : **Settings → Source → Branch** :
   `claude/follow-ai-saas-build-6pax2v`.
3. Dans le projet : **New → Database → PostgreSQL**.
4. Dans le service de l'application : **Settings → Volumes → Add Volume**, chemin de montage `/data`.
5. **Settings → Deploy → Pre-deploy command** : `npm run db:deploy -- --demo-seed`
   (crée les tables, puis les données de démonstration une seule fois ; ne touche jamais une base contenant des données réelles).
6. **Variables** du service de l'application :

   | Variable | Valeur |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (référence à la base créée à l'étape 3) |
   | `AUTH_MODE` | `local` |
   | `SESSION_SECRET` | mot de passe aléatoire de 40 caractères ou plus |
   | `APP_ENCRYPTION_KEY` | un **autre** mot de passe aléatoire de 40 caractères ou plus |
   | `DEMO_SEED_PASSWORD` | le mot de passe des comptes de démonstration (14 caractères minimum, à garder pour vous) |
   | `STORAGE_LOCAL_DIR` | `/data/storage` |
   | `DEMO_TOOLS` | `true` |
   | `LLM_PROVIDER` | `mock` (moteur de règles ; l'IA réelle viendra avec une clé) |
   | `CRON_SECRET`, `WEBHOOK_SIGNING_SECRET` | mots de passe aléatoires |
   | `WHATSAPP_VERIFY_TOKEN` | un mot de passe aléatoire (vous le recopierez chez Meta, étape 2.5) |
   | `WHATSAPP_APP_SECRET` | la « clé secrète » de l'app Meta (étape 2.6) |

   Mots de passe aléatoires : le générateur de votre gestionnaire de mots de passe (ou « mot de passe fort » de l'iPhone) suffit.
7. **Settings → Networking → Generate Domain** : vous obtenez une adresse du type `https://xxxx.up.railway.app`.
8. Ouvrez cette adresse : connexion avec `alice@demo.follow.ai` et le mot de passe `DEMO_SEED_PASSWORD`.

## Étape 2 — Meta : le numéro WhatsApp de test (≈ 20 min)

1. Sur **developers.facebook.com** (compte Facebook de l'entreprise) : **Mes apps → Créer une app**, type **Entreprise**.
2. Ajoutez le produit **WhatsApp**. Meta crée un **numéro de test** gratuit.
3. Page **Configuration de l'API** : notez
   - l'**identifiant du numéro de téléphone** (Phone number ID),
   - l'**identifiant du compte WhatsApp Business**,
   - le **jeton d'accès temporaire** (valable 24 h — voir « Jeton permanent » plus bas).
4. Toujours sur cette page, champ **« À »** : ajoutez **votre numéro de portable** et validez-le avec le code reçu (jusqu'à 5 numéros).
5. **Configuration → Webhook → Modifier** :
   - URL de rappel : `https://xxxx.up.railway.app/api/webhooks/whatsapp`
   - Jeton de vérification : la valeur de `WHATSAPP_VERIFY_TOKEN`
   - **Vérifier et enregistrer**, puis abonnez le webhook au champ **messages**.
6. **Paramètres de l'app → Général** : copiez la **clé secrète** dans la variable Railway `WHATSAPP_APP_SECRET` (Railway redéploie).

## Étape 3 — LÉA : brancher le numéro (2 min)

Dans LÉA → **Connexions → WhatsApp Business → Connecter le vrai WhatsApp Business** :
- identifiant du numéro, identifiant du compte, jeton d'accès (collé dans le champ prévu, jamais dans une conversation) ;
- **Mode test** coché ; **numéros de test** : votre portable ;
- « Vous êtes reconnu comme le client… » : choisissez un client de démonstration (ex. Maison Martin & Fils) — LÉA vous répondra
  avec ses commandes, factures et son stock ;
- **ne cochez aucun modèle** (le numéro de test Meta n'a pas nos modèles) ;
- cochez l'autorisation d'envoi réel → **Connecter WhatsApp**.

## Étape 4 — Parler à LÉA

Depuis votre téléphone, écrivez au **numéro de test Meta** sur WhatsApp, par exemple :
« Bonjour Léa, as-tu la référence JNS-10008 en stock ? », « Quand je reçois ma commande ? », « Envoie-moi mon bon de commande ».
LÉA répond dans la conversation (heures d'envoi de l'organisation : du lundi au vendredi, 8 h 30 – 18 h 30 ; hors de ces heures,
la réponse est programmée). Toute la discussion est visible dans LÉA → Conversations.

## Limites pendant le test

- **LÉA ne peut pas vous écrire en premier** : WhatsApp impose des modèles approuvés par Meta pour démarrer une conversation.
  Elle répond dans les 24 h qui suivent votre dernier message.
- **Jeton temporaire : 24 h.** Pour un jeton permanent : business.facebook.com → Paramètres → **Utilisateurs système** → ajouter un
  utilisateur système administrateur → **Générer un jeton** pour l'app, autorisations `whatsapp_business_messaging` et
  `whatsapp_business_management` → le coller dans Connexions (le champ vide conserve l'ancien).
- **Tâches planifiées** (journée de LÉA à 8 h, envois programmés) : non nécessaires pour ce test ; à ajouter ensuite
  (`/api/cron/daily-plan` et `/api/cron/dispatch` avec l'en-tête `Authorization: Bearer $CRON_SECRET`).
- **Réponses du moteur de règles** (pas encore l'IA réelle) : questions courantes comprises, le reste est transmis au commercial.

## Couper à tout moment

LÉA → Connexions → **Déconnecter** : plus aucun message réel ne part.
