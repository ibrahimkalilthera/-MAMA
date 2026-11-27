# Récupérer une file hors-ligne sans perdre de reçus

Ce document sert le jour où le poste affiche « N transaction(s) hors-ligne en attente »
et que la synchronisation refuse les mêmes gestes en boucle — le cas mesuré le
2026-11-27 : **38 gestes**, tous en `23503` sur `payments` (`insert or update on
table "payments" violates foreign key constraint`), parce que leur élève n'avait
jamais été créé (matricule tronqué, voir la migration
`20261127000000_students_matricule_no_truncation.sql`).

## La règle qui gouverne tout ce qui suit

**On ne vide jamais la file, et on ne supprime aucun geste à la main.**
Un geste en attente est un reçu ou une recette déjà annoncée à une famille. Le
rejeu retire une entrée **uniquement** quand la base l'a acceptée (ou quand elle
y était déjà : `23505` sur l'identifiant du geste). Tout le reste reste en file,
avec sa raison de refus.

## 1. Exporter la file (aucune suppression)

Sur le poste, ouvrir la console de l'application (`Ctrl+Shift+I`, onglet
« Console »), coller ce code, puis Entrée :

```js
(() => {
  const raw = localStorage.getItem('mama_thera_offline_queue');
  if (!raw) { console.warn('File hors ligne vide : rien à exporter.'); return; }
  const blob = new Blob([raw], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'file-hors-ligne-' + new Date().toISOString().slice(0, 10) + '.json';
  link.click();
  URL.revokeObjectURL(link.href);
  console.log('Gestes exportés :', JSON.parse(raw).length);
})();
```

Le même extrait est affiché par la commande, si on préfère le copier de là :

```bash
npm run offline:recovery -- --snippet
```

Le fichier téléchargé (`file-hors-ligne-AAAA-MM-JJ.json`) est la **preuve** de ce
qui attendait. On le garde, on ne le modifie pas.

## 2. Constater ce que la base fera de chaque geste

```bash
npm run offline:recovery -- "C:/Users/.../file-hors-ligne-2026-11-27.json"
```

La commande lit la base **en lecture seule** (élèves et paiements existants) et
écrit à côté du fichier :

- `file-hors-ligne-….rapport.md` — le constat, lisible par l'école ;
- `file-hors-ligne-….rapport.json` — le même, pour la suite.

Chaque geste reçoit un verdict :

| Verdict | Ce que ça veut dire | Ce qu'on fait |
| --- | --- | --- |
| `pret-a-partir` | la cible existe | laisser synchroniser |
| `cree-par-la-file` | l'élève n'existe pas encore, mais un `addStudent` de la file le crée **avec le même identifiant** | laisser synchroniser (deux passages si l'ordre est inversé) |
| `deja-en-base` | le reçu (ou la fiche) est déjà écrit | rien : le drainage retirera le geste sans compter deux fois |
| `sans-reference` | dépense, réglage, note, journal — aucun élève en jeu | laisser synchroniser |
| `eleve-a-rattacher` | l'élève visé n'existe pas et rien dans la file ne le crée | **rattacher** (§4) |
| `doublon-metier` | la fiche existe déjà sous un **autre** identifiant (même nom + téléphone + classe + année) | **rattacher** ; la correspondance est souvent proposée d'office |
| `recu-deja-pris` | le numéro de reçu est porté par un **autre** paiement | trancher à la main : un des deux reçus est faux |
| `cible-absente` | le paiement à corriger/supprimer n'existe pas | le geste ne fera rien ; le retirer est une décision, pas une évidence |

**« Perdu » n'est pas un verdict.** Un geste n'est perdu que si son reçu n'est
pas en base **et** qu'aucun élève ne peut lui être attribué : c'est exactement la
liste `eleve-a-rattacher`, et elle arrive avec le reçu, la date et le montant
pour reconnaître le papier. Tout le reste est récupérable.

## 3. Le cas le plus fréquent, et le plus simple

Si le rapport ne montre **aucun** geste `eleve-a-rattacher`, c'est que le
`addStudent` de l'élève est encore dans la file : le correctif de la base suffit.
Sur le poste : « Synchroniser maintenant », puis vérifier que le compteur de
gestes en attente descend à 0 et que l'élève apparaît avec son matricule (par
exemple `MT-2026-1000`).

## 4. Rattacher quand l'élève n'existe pas encore sous le bon identifiant

Deux situations, une seule question : **quel identifiant d'élève la base
connaît-elle ?**

### 4.1 Trouver (ou créer) la fiche réelle

Lire la base, jamais y écrire à la main pour un reçu :

```sql
select id, name, parent_phone, grade, academic_year, student_id
from public.students
where name ilike '%BOLLY%'
order by created_at desc;
```

- **la fiche existe** → relever son `id` (UUID) : c'est la cible du rattachement ;
- **la fiche n'existe pas** → la créer par l'application (avec le correctif de
  matricule, elle s'enregistre). Noter l'`id` de la fiche créée.

### 4.2 Écrire la correspondance

Un fichier `rattachement.json`, à côté du dump :

```json
{
  "00000000-0000-4000-8000-00000000aa01": "00000000-0000-4000-8000-00000000bb01"
}
```

- à gauche : l'identifiant local refusé (celui que le rapport nomme « cible … ») ;
- à droite : l'`id` de la fiche réelle, **relu en base**.

### 4.3 Produire la file corrigée

```bash
npm run offline:recovery -- "…/file-hors-ligne-2026-11-27.json" --map rattachement.json
```

La commande :

- refuse une cible absente de la base (aucune écriture sur un id inventé) ;
- réécrit **toutes** les références à cet élève (`addPayment.studentId`,
  `updateStudent.id`, `deleteStudent.id`, `todo.studentId`) ;
- **retire** le `addStudent` devenu inutile (la fiche existe) — et le nomme ;
- ne touche ni au montant, ni à la date, ni au numéro de reçu ;
- écrit un **nouveau** fichier `….corrigee.json`. L'original reste intact.

## 5. Déposer la file corrigée sur le poste

Dans la console de l'application, remplacer la file par le contenu du fichier
corrigé (garder l'original) :

```js
const corrigee = /* coller ici le contenu de file-hors-ligne-….corrigee.json */;
localStorage.setItem('mama_thera_offline_queue', JSON.stringify(corrigee));
console.log('Gestes dans la file :', JSON.parse(localStorage.getItem('mama_thera_offline_queue')).length);
```

Puis « Synchroniser maintenant ».

## 6. Vérifier que rien n'a été perdu ni compté deux fois

```sql
-- les paiements de l'élève rattaché : chaque reçu du papier doit y être, une fois
select receipt_number, amount, date, months, motif
from public.payments
where student_id = '<id élève>'
order by date;

-- aucun reçu en double dans toute l'école
select receipt_number, count(*)
from public.payments
where receipt_number is not null
group by 1 having count(*) > 1;

-- le solde de la fiche est dérivé des reçus (déclencheur), il doit suivre
select name, amount_paid, last_payment_date
from public.students where id = '<id élève>';
```

Sur le poste : le bandeau doit retomber à 0 geste en attente, et les reçus
réapparaître dans l'historique de l'élève. Si un geste reste, son `lastError`
dit pourquoi — c'est la bannière qui le nomme.

## 7. Ce qu'on ne fait jamais

- **Vider la file** (`localStorage.removeItem`, bouton de remise à zéro) : les
  reçus non encore écrits disparaîtraient sans trace.
- **Insérer les paiements à la main en SQL** : ils passeraient sans journal
  d'audit, sans le recalcul de solde du déclencheur, et le drainage les
  rejouerait ensuite.
- **Supprimer le dump d'origine** : c'est la seule preuve de ce qui attendait
  le jour du constat.
- **Rattacher « au nom »** : deux homonymes légitimes existent (« Awa DIARRA »
  ×3 dans l'historique du dépôt). La cible est un `id` relu en base, pas un nom.
