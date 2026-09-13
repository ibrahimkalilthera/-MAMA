/**
 * L'ORIGINE PUBLIQUE QUE LE POSTE EMBARQUE — une seule définition.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * L'application de bureau charge son interface LOCALE (`file://`), et bascule
 * sur cette origine quand ce chargement échoue (`electron/main.cjs`, `loadFile`
 * → `loadURL`). C'est donc une URL embarquée dans CHAQUE installeur : si elle ne
 * répond plus, un poste dont l'interface locale ne démarre pas n'a plus aucun
 * repli, et personne ne l'apprend tant qu'un utilisateur ne le dit pas.
 *
 * Elle était écrite en clair dans `electron/main.cjs`, et le contrôle qui la
 * relit ne pouvait donc que recopier la même chaîne — deux écritures qui
 * s'accordent le jour où on les écrit. Elle vit ici, et les deux la lisent :
 * le `.cjs` est le seul format qu'un processus principal Electron (`require`) et
 * un script de contrôle (`createRequire`) peuvent partager sans build.
 *
 * Le reste du dépôt (E2E, garde CSP, pixel-check PDF) prend cette origine par
 * défaut, avec `--url=` pour viser autre chose : ce fichier est la valeur par
 * défaut du PROJET, pas un réglage de script.
 */
const PUBLIC_ORIGIN = 'https://mama-thera-finance.vercel.app/';

module.exports = { PUBLIC_ORIGIN };
