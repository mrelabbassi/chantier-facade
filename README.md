# ChantierFaçade

Suivi de chantier pour façades aluminium : tableau de bord, chantiers et kanban, éléments de façade (import/export Excel et CSV), réserves, documents versionnés, photos, CRM et devis.

## Stack

Express 5 (API et service de l'interface), React 19, Vite, Tailwind CSS 4, SQLite (module `node:sqlite` de Node 22).

## Lancer en local

```bash
npm install
cp .env.example .env          # puis renseignez ADMIN_EMAIL et ADMIN_PASSWORD
npm run build
npm start                     # http://localhost:3000
```

Pour développer avec rechargement à chaud : lancez `npm start` dans un terminal, puis `npm run dev` dans un autre (Vite redirige `/api` vers le port 3000).

Pour charger un jeu de démonstration (chantier, 600 éléments de façade, comptes avec le mot de passe `demo1234`), démarrez avec `SEED_DEMO=true` sur une base vide.

## Variables d'environnement

| Variable | Rôle |
| --- | --- |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Premier administrateur, créé seulement si la base ne contient aucun utilisateur. Mot de passe de 10 caractères minimum. |
| `ADMIN_NAME` | Nom affiché de l'administrateur (facultatif). |
| `SEED_DEMO` | `true` pour créer les données de démonstration au premier démarrage. |
| `NODE_ENV` | `production` active le cookie `Secure` (HTTPS obligatoire). |
| `PORT` | Port d'écoute (Render le fournit automatiquement). |

## Authentification

Connexion par email et mot de passe. Le navigateur reçoit un cookie de session HttpOnly valable 30 jours. Les mots de passe sont hachés avec scrypt. Après 10 échecs en 15 minutes pour un même email et une même adresse, la connexion est temporairement bloquée.

Les comptes sont créés par un administrateur dans la page **Utilisateurs**, qui permet aussi de changer les rôles et de réinitialiser un mot de passe.

## Créer l'administrateur manuellement

Si les variables `ADMIN_EMAIL` et `ADMIN_PASSWORD` n'ont pas été prises en compte au démarrage, créez le compte depuis le Shell de Render :

```bash
npm run create-admin -- votre@email.ma "votre-mot-de-passe-10-caracteres" "Votre Nom"
```

Si l'email existe déjà, le compte devient administrateur et son mot de passe est remplacé.

## Déploiement sur Render

1. Poussez le dépôt sur GitHub.
2. Dans Render : **New → Blueprint**, sélectionnez le dépôt. Render lit `render.yaml`.
3. Renseignez `ADMIN_EMAIL` et `ADMIN_PASSWORD` lorsque Render les demande.
4. Une fois le service démarré, connectez-vous avec ces identifiants.

Le disque persistant de 1 Go (`/opt/render/project/src/data`) contient la base SQLite et les fichiers téléversés. Il impose le plan payant et une seule instance. Sans disque, toutes les données seraient perdues à chaque déploiement.

## Tests

Le test de fumée vérifie les droits par rôle, les documents, les photos, le CRM et l'import Excel. Il s'exécute contre un serveur lancé avec `SEED_DEMO=true` sur une base vide :

```bash
SEED_DEMO=true npm start &
npm run smoke
```
