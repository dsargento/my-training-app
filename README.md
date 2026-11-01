# Sport Quest

Suivi ludique de ton programme de powerlifting, alimenté par ton tableur.

## Lancer

```bash
npm install
cp .env.example .env   # puis renseigne SHEET_SOURCE et ANTHROPIC_API_KEY
npm start              # http://localhost:3000
```

## Comment ça marche

- **Source** : `SHEET_SOURCE` = chemin d'un `.xlsx` ou lien Google Sheets (partagé « Toute personne disposant du lien »).
- **Règle** : un exercice est fait dès que sa case **Load** est remplie (`120/130/135` = une charge par série).
- **Table de charges** : pour chaque exercice, le 1RM est estimé à partir de sa séance la plus récente (charge notée + RPE prévu), puis croisé reps (1-12) × RPE (5-10). Les charges suggérées de la prochaine séance viennent de la même table.
- **Dates** : le tableur n'en contient pas, une séance est datée du jour où l'appli la voit faite pour la première fois (`data/state.json`).
- **Changer de programme** : modifie `SHEET_SOURCE` et `PROGRAM_NAME` dans `.env`. L'ancien programme est archivé automatiquement (séances commencées) : XP, niveau, journal et records continuent, la carte et les succès de blocs repartent sur le nouveau. Revenir à une ancienne source la reprend où elle en était.
- **IA (Claude)** : classe les noms d'exercices (variantes, mouvement de compétition) et rédige le bilan du coach. Sans clé, l'appli marche avec un classement par mots-clés.
- **Jeu** (`src/game.js`, sans IA) : 10 XP par exercice + 10 XP par tonne, +50 séance parfaite, +150 semaine complète ; 1RM estimés via la table RPE ; charges suggérées pour la prochaine séance.
