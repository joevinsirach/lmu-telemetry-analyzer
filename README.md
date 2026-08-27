# LMU Télémétrie Analyse

🌐 **Français** · [English](README.en.md)

Une application web légère et locale pour analyser la télémétrie de **Le Mans Ultimate**. Elle lit les
**fichiers de télémétrie DuckDB** enregistrés par le jeu (`UserData\Telemetry\*.duckdb`), charge
automatiquement le dernier enregistrement et te montre **où tu perds du temps sur la piste** – avec en
plus une analyse pneus/freins, un calculateur d'arrêts aux stands/énergie et une comparaison de setups.

> Application 100 % locale – fonctionne hors ligne, pas de cloud, pas de compte. Un petit « pont » Node
> lit les fichiers DuckDB via la CLI DuckDB fournie et sert l'interface HTML sur `http://localhost:8777`.

## Fonctionnalités

- 🎯 **Où est-ce que je perds du temps ?** – Delta de temps sur le tour, zones de perte détectées automatiquement avec des conseils concrets (point de freinage, vitesse minimale, remise des gaz).
- 📈 **Comparaison** – Vitesse / accélérateur / frein / direction / rapport de deux tours superposés.
- 🗺️ **Carte de piste interactive** (grande, en haut ; aussi dans les onglets Comparaison et Pneus) – survoler la piste avec la souris affiche **vitesse, delta, accélérateur et frein** à cet endroit ; coloration commutable entre delta (gain/perte) ou vitesse ; dans l'onglet Pneus, coloration par **température de frein** (moyenne des 4 freins) ; synchronisée avec les graphiques. **Toutes les cartes de piste sont zoomables** (molette pour zoomer, glisser pour déplacer, double-clic pour réinitialiser).
- 📂 **Import d'un tour de référence** – charge ton propre fichier **MoTeC `.ld`** comme tour de référence et compare tes tours par rapport à celui-ci.
- ⏱️ **Temps aux secteurs** – S1/S2/S3 par tour, meilleurs secteurs mis en évidence, meilleur temps théorique.
- 🌦️ **Météo & piste** – conditions, température air/piste, vent, humidité.
- 🧭 **Carte de piste gain/perte** – mini-carte toujours visible (barre latérale), vert = temps gagné, rouge = temps perdu.
- 📋 **Dernière session** – tableau de tous les tours : temps, Δ par rapport au meilleur temps, vitesse de pointe, consommation d'énergie virtuelle/carburant/pneus par tour.
- 🔄 **Vérification de version** – t'avertit automatiquement quand une nouvelle version est disponible sur GitHub.
- 🛞 **Pneus & freins** – température (intérieur/milieu/extérieur par roue), pression, profil restant/usure, températures de freins + conseils sur pression/carrossage/équilibrage.
- 🔧 **Setup & rythme** – compare deux de tes sessions : ce qui a changé dans le setup et comment le meilleur temps a évolué, plus des conseils de setup basés sur la télémétrie. Inclut une section avec des liens vers des **fournisseurs de setups** externes.
- ⛽ **Calculateur d'arrêts aux stands** – à partir de la longueur de course, des jeux de pneus, des pilotes et du rythme/de la consommation mesurés : durée des relais, énergie virtuelle cible par tour, stratégie au temps total le plus rapide, répartition des pilotes (tient compte à la fois de l'énergie **et** de l'usure des pneus). Plus une **carte de piste lift & coast** : montre les zones de freinage au meilleur potentiel d'économie de carburant (① = meilleure zone), avec une distance de lever de pied dynamique selon la vitesse d'entrée et des stratégies sélectionnables.
- ⏺ **Live** – charge automatiquement le nouvel enregistrement après chaque relais ; pendant qu'un enregistrement est en cours (fichier verrouillé), la dernière session terminée est affichée.
- 🌐 **Langue** – interface commutable en un clic entre **français, anglais et allemand** (en haut à droite).
- 🪟 **Interface épurée** – **barre latérale rétractable**, **graphique de delta** aussi dans l'onglet Comparaison, et un bouton d'accueil dans l'en-tête. Les comparaisons de delta ignorent systématiquement les tours d'entrée/sortie de stand comme référence.

## Prérequis

- Windows avec **Le Mans Ultimate** (PC, à partir de la v1.2 avec enregistrement de télémétrie natif).
- **Node.js** – pour exécuter le pont. Il est **installé/téléchargé automatiquement** par le lanceur s'il est absent (via winget ou en version portable, sans droits administrateur).
- L'enregistrement de télémétrie doit être activé dans LMU (voir ci-dessous).

## Activer l'enregistrement de télémétrie dans LMU

Dans `…\Le Mans Ultimate\UserData\player\Settings.JSON` :

```json
"Automatically Record Telemetry": true
```

(Ferme LMU avant.) Alternative : dans le jeu, sous *Options → Configuration des touches*, assigne la
fonction **« Telemetry Recording »** à une touche et démarre-la manuellement à chaque relais. Des
fichiers `.duckdb` apparaissent ensuite dans `UserData\Telemetry`.

## Démarrage

**Le plus simple – sans fenêtre de console :** double-clique sur **`LMU-Telemetry-Analyzer-Vx.x.x.exe`**.
L'application démarre entièrement en arrière-plan (**pas de fenêtre noire en ligne de commande**) et
ouvre le navigateur automatiquement. Pour quitter, utilise le **bouton ⏻** en haut à droite de
l'application. (La CLI DuckDB est téléchargée au premier démarrage si elle n'est pas déjà présente à
côté. Les messages de l'application sont écrits dans `lmu-telemetrie.log`, à côté de l'exécutable.)

**Depuis les sources (avec Node.js) :** double-clique sur **`Start LMU Telemetrie.cmd`**. Au premier
démarrage, le script récupère automatiquement **Node.js** (si nécessaire) et la **CLI DuckDB**, démarre
le pont et ouvre `http://localhost:8777` dans le navigateur.

Le dossier de télémétrie est trouvé automatiquement via les bibliothèques Steam. Pour un chemin
différent :
```
node lmu-bridge.js --dir="D:\chemin\vers\Le Mans Ultimate\UserData\Telemetry"
```

## Fonctionnement

LMU écrit la télémétrie sous forme de **base de données DuckDB** – une table par canal/événement
(`value` ou `value1..4` par roue), plus des tables de métadonnées (`metadata`, `channelsList`,
`eventsList`) ; le setup complet du véhicule est stocké en JSON dans `metadata`. Comme un navigateur ne
peut pas lire DuckDB directement, le pont (`lmu-bridge.js`) lit les fichiers via `duckdb.exe` et les
fournit en JSON. Toute l'analyse (détection des tours, delta, pneus, stratégie) s'exécute dans le
navigateur (`lmu-telemetry-analyzer.html`, JavaScript pur, graphiques Canvas maison, aucune bibliothèque
externe).

## Confidentialité

**Aucune donnée n'est envoyée en ligne.** Les références de meilleurs temps et l'historique des sessions
ne sont stockés que localement dans le navigateur (`localStorage`). Les fichiers de télémétrie restent
sur ta machine.

## Licence

MIT – voir [LICENSE](LICENSE). Ce projet n'est pas un produit officiel Studio-397/Motorsport Games ;
« Le Mans Ultimate » est la propriété de ses ayants droit respectifs.
