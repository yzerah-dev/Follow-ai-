# Follow.AI

**Votre équipe commerciale augmentée par l'intelligence artificielle.**

SaaS B2B multi-entreprises pour grossistes, importateurs, distributeurs et industriels. LÉA, l'agent commercial IA,
analyse les factures, détecte les opportunités (réassorts, clients dormants, nouveautés, ventes complémentaires),
prépare les offres et leurs supports (PDF, Excel illustré, catalogue, fiches, affiche), rédige les messages,
traite les réponses et objections — et l'humain valide chaque action sensible.

## Démarrage local

Prérequis : Node.js ≥ 22, PostgreSQL 16 (local).

```bash
npm install
cp .env.example .env.local          # puis renseigner SESSION_SECRET et APP_ENCRYPTION_KEY
npm run db:reset                    # crée la base follow_ai, applique les migrations, charge la démo
npm run build && npm run start      # http://localhost:3000   (ou npm run dev)
```

Comptes de démonstration (mot de passe `demo-follow-ai`) — **données entièrement fictives** :

| Compte | Organisation | Rôle |
|---|---|---|
| alice@demo.follow.ai | JONAS — Démo | Propriétaire |
| bruno@demo.follow.ai | JONAS — Démo | Commercial |
| diane@demo.follow.ai | JONAS — Démo | Lecture seule |
| chloe@demo.follow.ai | Négoce Beta — Démo | Propriétaire |

Parcours conseillé (Bruno) : Accueil → « Maison Martin & Fils — Réassort probable de 4 références » → *Préparer l'offre*
→ *Créer mes supports* → valider les documents et l'offre → *Rédiger l'email avec LÉA* → *Valider et envoyer (simulation)*
→ *Simuler la réponse du client* → valider la réponse de LÉA → le client accepte → *préparer la commande*.

## Qualité

```bash
npm run typecheck      # TypeScript strict
npm run lint           # ESLint (next + typescript)
npm run test           # tests unitaires (Vitest)
npm run test:integration   # PostgreSQL réel : scénario complet, RLS multi-tenant, imports
npm run build && npm run e2e   # Playwright : scénario principal via l'interface
```

## Ce qui est réel / simulé

- **Réel** : base multi-tenant avec RLS, authentification, analytique factures, moteur d'opportunités, construction d'offres,
  politique de remise, génération PDF/Excel, imports CSV/XLSX, garde-fous IA, journal d'audit.
- **Simulé et signalé** : IA (`LLM_PROVIDER=mock`, badge « IA simulée ») tant qu'aucune clé n'est fournie ; envoi d'emails
  (connexion « mode simulation », badge « Envoi simulé ») ; visuels produits de démonstration.
- **Non configuré** : Gmail / Microsoft 365, WhatsApp, LinkedIn, SMS, téléphonie, génération d'images.

Voir [docs/PROGRESS.md](docs/PROGRESS.md) pour l'état détaillé et [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) pour la mise en production.

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Base de données](docs/DATABASE.md) · [Sécurité](docs/SECURITY.md) ·
[Cerveau de LÉA](docs/LEA_BRAIN.md) · [Règles commerciales](docs/COMMERCIAL_RULES.md) · [Studio créatif](docs/CREATIVE_STUDIO.md) ·
[Intégrations](docs/INTEGRATIONS.md) · [Formats d'import](docs/IMPORT_FORMATS.md) · [Plan de test](docs/TEST_PLAN.md) ·
[Déploiement](docs/DEPLOYMENT.md) · [Décisions](docs/DECISIONS.md) · [Avancement](docs/PROGRESS.md)
