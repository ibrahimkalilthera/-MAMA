# Rapport — reçus en double potentiels

**Date du rapport :** 5 octobre 2026
**Base interrogée :** production partagée `rpcjdohfxwukbqngbprw` (lecture seule, connexion directe `postgres`)
**Objet :** repérer les paiements qui pourraient être un même reçu saisi deux fois.

---

## 1. Critère retenu

Un **groupe suspect** = plusieurs lignes de `public.payments` qui portent :

- le **même élève** (`student_id`),
- la **même date** (`date`),
- le **même montant** (`amount`).

C'est le signal « classique » d'un double enregistrement (double clic sur « Enregistrer », reçu réimprimé et ressaisi). Il ne prouve pas un doublon : deux versements du même montant le même jour restent possibles — c'est justement à l'école de trancher, ligne par ligne.

Deux contrôles **complémentaires** sont joints :

- **numéro de reçu réutilisé** : un même `receipt_number` sur plusieurs lignes ;
- **listing complet** des paiements, pour lecture humaine.

---

## 2. Résultat

| Contrôle | Concernés |
|---|---|
| Paiements présents en base | **2** |
| Groupes « même élève + même date + même montant » | **0** |
| Numéros de reçu réutilisés | **0** |

**Aucun reçu en double potentiel n'a été trouvé.**

---

## 3. Contexte — les paiements analysés

| Élève | Date | Montant | Reçu | Année | Saisi le |
|---|---|---|---|---|---|
| Mariam KANE | 02/10/2026 | 4 000 FCFA | REC-568556 | 2026-2027 | 02/10/2026 06:48 |
| Djenebou DIALLO | 05/10/2026 | 4 000 FCFA | REC-549205 | 2026-2027 | 05/10/2026 06:11 |

Les deux lignes sont **distinctes** : élèves différents, dates différentes, reçus différents.

---

## 4. Ce que ce rapport ne prouve pas

⚠️ **La table `payments` ne contient que 2 lignes**, pour une école de ~400 élèves. Le rapport est donc **quasi vide par construction** : il n'y a presque rien à analyser. Deux lectures possibles, à trancher par l'école :

1. le module de paiement vient d'être mis en service et l'essentiel de l'historique n'y est pas encore saisi ; ou
2. l'historique de caisse vit ailleurs (par exemple dans le montant cumulé `students.amount_paid`) et n'a jamais produit de ligne `payments` — auquel cas **aucun contrôle de doublon n'est possible** sur cet historique.

Tant que la table reste aussi pauvre, ce rapport ne peut pas détecter grand-chose : il faudra le **relancer** une fois les paiements réels saisis.

---

## 5. Méthode (reproductible)

Contrôle principal :

```sql
select p.student_id, s.name as student_name, p.date, p.amount, count(*)::int as n,
       array_agg(coalesce(p.receipt_number,'') order by p.id) as receipts
from public.payments p
left join public.students s on s.id = p.student_id
group by p.student_id, s.name, p.date, p.amount
having count(*) > 1
order by p.date, s.name;
```

Numéros de reçu réutilisés :

```sql
select coalesce(p.receipt_number,'') as receipt_number, count(*)::int as n
from public.payments p
where coalesce(p.receipt_number,'') <> ''
group by coalesce(p.receipt_number,'')
having count(*) > 1;
```

---

## 6. Suite recommandée

- Relancer ce contrôle à chaque fin de période de caisse (ou chaque fois que des paiements en volume sont saisis).
- Pour un doublon **confirmé**, le retirer depuis la fiche de l'élève : le bouton **supprimer un paiement** retire la seule ligne fautive et écrit l'opération au **journal d'audit**.
