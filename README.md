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
- **Anciens programmes** : liste-les dans `data/programs.json` (chaque tableur partagé par lien) :
  ```json
  [{ "name": "Prep On Lève Ça", "source": "<lien Google Sheets>", "end": "2026-09-26" }]
  ```
  `start` ou `end` (ex. le jour de compète) sert à dater les séances, étalées sur chaque semaine. Chaque programme est importé une fois (réimporté si sa ligne change, retiré si elle disparaît).
- **Records** : comparés au programme en cours (la référence repart à chaque programme) ; ceux qui battent aussi tout l'historique sont marqués « record absolu ». Les records de tous les temps sont repliés en bas de la salle des trophées. Une charge notée « fail » ou « raté » ne compte pas.
- **IA (Claude)** : classe les noms d'exercices (variantes, mouvement de compétition) et rédige le bilan du coach. Sans clé, l'appli marche avec un classement par mots-clés.
- **Jeu** (`src/game.js`, sans IA) : 10 XP par exercice + 10 XP par tonne, +50 séance parfaite, +150 semaine complète ; 1RM estimés via la table RPE ; charges suggérées pour la prochaine séance.

## Mise en ligne (Raspberry Pi + Cloudflare Tunnel)

La page est publique en lecture seule : elle affiche l'état de la dernière synchro (`data/game.json`), sans rien recalculer.
La **synchro** et le **coach** demandent le mot de passe `SYNC_PASSWORD` (cookie valable 3 mois, 5 essais ratés par quart d'heure au maximum).
Sans `SYNC_PASSWORD`, tout est ouvert : réservé à l'usage en local.

1. **Node ≥ 22.9** sur le Pi (`node -v`). Pi 3/4/5 : paquets officiels (NodeSource ou nvm). Pi 1/Zero (armv6) : builds non officiels uniquement.
2. **Code et données** :
   ```bash
   git clone git@github.com:dsargento/my-training-app.git ~/sport-quest && cd ~/sport-quest && npm ci --omit=dev
   # depuis le PC : le .env (avec SYNC_PASSWORD) et l'historique
   scp .env pi@raspberrypi.local:~/sport-quest/ && scp -r data pi@raspberrypi.local:~/sport-quest/
   ```
3. **Service** : `sudo cp deploy/sport-quest.service /etc/systemd/system/` (adapter `User`/`WorkingDirectory`), puis `sudo systemctl enable --now sport-quest`. Logs : `journalctl -u sport-quest -f`.
4. **Tunnel** (nécessite un nom de domaine géré par Cloudflare) :
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create sport-quest
   cloudflared tunnel route dns sport-quest quest.mon-domaine.fr
   ```
   Puis `~/.cloudflared/config.yml` (l'identifiant du tunnel est affiché par `tunnel create`) :
   ```yaml
   tunnel: <id-du-tunnel>
   credentials-file: /home/pi/.cloudflared/<id-du-tunnel>.json
   ingress:
     - hostname: quest.mon-domaine.fr
       service: http://localhost:3000
     - service: http_status:404
   ```
   Test : `cloudflared tunnel run sport-quest`. Au démarrage du Pi : `sudo cloudflared --config ~/.cloudflared/config.yml service install`.
   Aucun port à ouvrir sur la box ; le HTTPS est géré par Cloudflare.
