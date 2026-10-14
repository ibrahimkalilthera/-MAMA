/**
 * Numeric WCAG lock for the light-theme contrast fixes (db70bc3 + the
 * theme remap layers — src/index.css + src/themes/*.css, read as one corpus)
 * — with an AUTO-DERIVED manifest.
 *
 * Why numeric + static: the browser audit (scripts/theme-contrast-audit.mjs)
 * gates every theme at 3:1 for large/UI text, but small text (chips,
 * captions, pills: 9-12px) needs the WCAG AA 4.5:1 bar, and it only measures
 * whatever happens to be rendered with the ephemeral account's data. This
 * suite resolves the actual colors — base Tailwind palette, overridden by
 * each light theme's remap rules parsed from the theme CSS corpus — and asserts:
 *
 *   1. the light themes' remapped TEXT families (navy/emerald/bordeaux
 *      darken slate-400, emerald-500/600, rose-500/600, blue-500; cream
 *      remaps its own set) always clear 4.5:1 against the theme's light
 *      card; and their remapped solid-ACCENT backgrounds keep white text
 *      above 4.5:1 (the "white CTA on emerald-600" family);
 *   2. EVERY text-x / bg-x token pair that co-occurs in the same static segment of
 *      a className literal (manifest derived by tests/tailwind-pairs.ts —
 *      no hand-maintained list to go stale) resolves to >= 4.5:1 in ALL
 *      four light themes. A new low-contrast pair in any component fails
 *      here immediately, without anyone updating a manifest;
 *   3. every light fill (bg-*-50/100/200) carries a dark:bg-* counterpart
 *      in the same segment (the midnight white-chip defect class), modulo
 *      the documented fixed-light exemptions below; and the HOVER surfaces —
 *      which are no longer recipes but the VALUES of one scale per theme —
 *      keep the theme's ink readable on every one of the six themes. (Le
 *      verrou des paires `hover:/dark:hover:` a été retiré avec son sujet : la
 *      migration vers src/themes/state-hover.css a supprimé les recettes, et
 *      `scripts/check-state-hover.mjs` les refuse désormais à la source.)
 *   4. the DARK themes (slate: CSS !important remap layer; midnight:
 *      dark: variants alone) clear the same 4.5:1 bar: every remapped
 *      text family on the slate card, every accent-solid background
 *      against readable text, the :is() whiten-surface list staying in
 *      sync with the remap layer, and every derived text/bg pair as
 *      RESOLVED under each dark theme.
 *
 *   5. every ink worn ONLY under the cursor (`hover:text-*`) that the engine
 *      actually RENDERS clears the same 4.5:1 bar on the surface the theme
 *      paints under it — `judgeHoverInk`, whose mask (a rest ink a theme forces
 *      with `!important`) was measured in Chrome before it was modelled, so the
 *      rule reports the inks that render and says MASKED about the ones that
 *      do not.
 *
 * Pure suite: no DOM, no React — plain node:test + fs + the shared scanner
 * (see tests/harness.ts "When NOT to use it").
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIGHT_THEMES,
  textOverrides,
  bgOverrides,
  extractColorPairs,
  extractMissingDarkBg,
  extractDarkColorPairs,
  resolve,
  resolveDark,
  contrast,
  composite,
  lum,
  hexRgb,
  rgbaToSolid,
  CARD,
  DARK_CARD,
  slateTextRemap,
  slateBgRemap,
  slateDarkSurfaces,
  whitenSurfaces,
  judgeUnpaintedSurfaces,
  CSS_TEXT,
  judgeHoverInk,
  type LightTheme,
} from './tailwind-pairs.ts';
import {
  STATE_HOVER_CLASSES,
  STATE_HOVER_CLASSES_WITHOUT_TOKEN,
  STATE_HOVER_TOKENS,
  STATE_VARS,
} from '../scripts/lib/state-hover.mjs';

/** The remapped accent families monitored in section 1 (bg tokens that carry white text). */
const ACCENT_SOLID = /^(blue|indigo|emerald|rose|amber|teal|purple|cyan)-(500|600|700)$/;

describe('light-theme remap layer — every remapped family clears WCAG AA 4.5:1', () => {
  it('parses a sane number of remap rules (guard against parser drift)', () => {
    assert.ok(textOverrides.size >= 8, `expected >= 8 light-theme text remaps, parsed ${textOverrides.size}`);
    assert.ok(bgOverrides.size >= 2, `expected >= 2 light-theme bg remaps, parsed ${bgOverrides.size}`);
  });

  it('remapped text families are >= 4.5:1 on their light card', () => {
    for (const theme of LIGHT_THEMES) {
      for (const [key, hex] of textOverrides) {
        const [t, token] = key.split(' ');
        if (t !== theme) continue;
        // Whitening rules (text-white on dark banners etc.) are not
        // dark-on-light families — skip them (they must stay light).
        if (lum(hexRgb(hex)) >= 0.5) continue;
        const ratio = contrast(hex, CARD[theme]);
        assert.ok(ratio >= 4.5,
          `${theme} remaps text-${token} to ${hex}: ${ratio.toFixed(2)}:1 on ${CARD[theme]} (< 4.5)`);
      }
    }
  });

  it('remapped solid accent backgrounds keep white text >= 4.5:1', () => {
    for (const theme of LIGHT_THEMES) {
      for (const [key, hex] of bgOverrides) {
        const [t, token] = key.split(' ');
        if (t !== theme || !ACCENT_SOLID.test(token)) continue;
        const ratio = contrast('#ffffff', hex);
        assert.ok(ratio >= 4.5,
          `${theme} remaps bg-${token} to ${hex}: white text is only ${ratio.toFixed(2)}:1 (< 4.5)`);
      }
    }
  });
});

describe('derived manifest: every co-occurring text/bg pair >= 4.5:1 in all light themes', () => {
  // The manifest IS the scan — nothing to maintain by hand. Known pairs
  // whose failure mode is "wrong branch pairing" (the text belongs to a
  // sibling element, not this bg) are impossible by construction: the
  // AST chunks guarantee same-segment co-occurrence. Tokens outside the
  // palette (arbitrary values, gradients) are surfaced as a coverage
  // warning, not silently skipped.
  const pairs = extractColorPairs();
  const unique = new Map<string, { text: string; bg: string; at: string[] }>();
  for (const p of pairs) {
    const key = `${p.text}|${p.bg}`;
    if (!unique.has(key)) unique.set(key, { text: p.text, bg: p.bg, at: [] });
    unique.get(key)!.at.push(`${p.file}:${p.line}`);
  }

  it('derives a sane manifest size (guard against scanner drift)', () => {
    assert.ok(unique.size >= 20, `expected >= 20 unique pairs, derived ${unique.size}`);
  });

  /**
   * Fixed-DARK surfaces — exempt from the light-card model by design
   * (the scanner cannot see ancestor context, so these are documented):
   *  - Sidebar.tsx CTA row: sits on the fixed-dark gradient sidebar
   *    (`app-sidebar`, text-white), emerald-300 on emerald-600/20 is the
   *    intended light-on-dark pairing;
   *  - DashboardView hero card (`card-hero`): a fixed-dark gradient with
   *    white headings — its emerald-400 accents are light-on-dark too
   *    (bg-emerald-500/[0.12] arbitrary alphas resolve to the 500 base
   *    token here, a conservative over-estimate of the real wash);
   *  - WelcomeBanner role badges: the banner is a fixed-dark gradient
   *    (white heading via inline style) — *-400 on *-500/20 is the
   *    intended light-on-dark pairing;
   *  (The ModalShell header — title bar + step strips — is a fixed-dark
   *  #0F172A surface in every theme, so accent chips over it are
   *  light-on-dark by design; the modal entries left this list as the
   *  scaffold migrated to modalTokens.)
   */
  const FIXED_DARK_PAIRS = new Set([
    'emerald-300|emerald-600/20',
    'emerald-400|emerald-500',
    'emerald-400/80|emerald-500',
    'emerald-400|emerald-500/20',
    'cyan-400|cyan-500/20',
    'blue-400|blue-500/20',
    'purple-400|purple-500/20',
  ]);

  it('every derived token is in the palette or remapped (no silent skips)', () => {
    const unknown = new Set<string>();
    for (const { text, bg } of unique.values()) {
      const baseText = text.split('/')[0];
      const baseBg = bg.split('/')[0];
      for (const theme of LIGHT_THEMES) {
        if (resolve(theme, 'text', baseText) === undefined) unknown.add(`text-${baseText}`);
        if (resolve(theme, 'bg', baseBg) === undefined) unknown.add(`bg-${baseBg}`);
      }
    }
    assert.deepEqual([...unknown], [], 'tokens missing from tests/tailwind-pairs.ts PALETTE');
  });

  for (const [key, info] of [...unique.entries()].sort()) {
    const [text, bg] = key.split('|');
    it(`${key} (${info.at.length}×, e.g. ${info.at[0]})`, () => {
      if (FIXED_DARK_PAIRS.has(key)) return; // documented fixed-dark surface
      for (const theme of LIGHT_THEMES) {
        const fg = resolve(theme, 'text', text.split('/')[0]);
        const bgRaw = resolve(theme, 'bg', bg.split('/')[0]);
        const alpha = bg.includes('/') ? parseInt(bg.split('/')[1]) / 100 : 1;
        const bgHex = alpha === 1 ? bgRaw : composite(bgRaw, alpha, CARD[theme]);
        const ratio = contrast(fg, bgHex);
        assert.ok(ratio >= 4.5,
          `${info.at[0]}: text-${text} on bg-${bg} = ${ratio.toFixed(2)}:1 in ${theme} (< 4.5)`);
      }
    });
  }
});

/**
 * Midnight white-chip lock — light fills (bg-*-50/100/200) must each carry
 * a `dark:bg-*` counterpart in the same segment or they render as bright
 * chips on the midnight body. The old hand-listed DARK_PAIRS are subsumed:
 * any NEW light fill without a dark: counterpart fails here automatically.
 *
 * Documented exemptions (fixed-light surfaces by design):
 *  - print containers/headers: rendered ONLY for paper (white bg forced)
 *  - Login.tsx: the login screen is a fixed-light marketing surface
 *  - FloatingChat message history: fixed-light widget interior
 *  - SharedUi HighlightText <mark>: yellow highlight with explicit
 *    text-slate-900 (>= 10:1 on every theme)
 *  - ArchivesView close-out banner: 20%-alpha wash OVER the themed card
 *    (the card's own dark surface still shows through)
 */
describe('dark themes (slate + midnight): remap layers clear WCAG AA 4.5:1', () => {
  it('slate remapped text families are >= 4.5:1 on the slate card', () => {
    for (const [token, v] of slateTextRemap) {
      const hex = v.startsWith('rgba') ? rgbaToSolid(v, DARK_CARD.slate) : v;
      const ratio = contrast(hex, DARK_CARD.slate);
      assert.ok(ratio >= 4.5,
        `slate remaps text-${token} to ${v}: ${ratio.toFixed(2)}:1 on the slate card (< 4.5)`);
    }
  });

  it('slate accent-solid surfaces carry readable text (white or near-black, whichever fits)', () => {
    for (const [token, v] of slateBgRemap) {
      if (!ACCENT_SOLID.test(token)) continue;
      const hex = v.startsWith('rgba') ? rgbaToSolid(v, DARK_CARD.slate) : v;
      const white = contrast('#F8FAFC', hex);
      const dark = contrast('#0F172A', hex);
      assert.ok(Math.max(white, dark) >= 4.5,
        `slate remaps bg-${token} to ${v}: best text ratio is only ${Math.max(white, dark).toFixed(2)}:1 (< 4.5)`);
    }
  });

  it('the :is() whiten surfaces stay in sync with the bg remap layer', () => {
    assert.ok(whitenSurfaces.size >= 10, `parsed ${whitenSurfaces.size} :is() surfaces`);
    for (const s of whitenSurfaces) {
      assert.ok(slateDarkSurfaces.has(s), `:is() surface bg-${s} has no .theme-slate .bg-${s} remap`);
    }
  });
});

describe('derived dark manifest: every co-occurring text/bg pair >= 4.5:1 in slate + midnight', () => {
  const pairs = extractDarkColorPairs();
  const unique = new Map<string, { theme: string; text: string; bg: string; at: string[] }>();
  for (const p of pairs) {
    const key = `${p.theme} ${p.text}|${p.bg}`;
    if (!unique.has(key)) unique.set(key, { theme: p.theme, text: p.text, bg: p.bg, at: [] });
    unique.get(key)!.at.push(`${p.file}:${p.line}`);
  }

  it('derives a sane dark manifest size (guard against scanner drift)', () => {
    assert.ok(unique.size >= 20, `expected >= 20 unique dark pairs, derived ${unique.size}`);
  });

  /**
   * Documented exemptions, mirroring the light suite's FIXED_DARK_PAIRS:
   *  - DashboardView card-hero gradient (lines 66/71): fixed dark in EVERY
   *    theme — its emerald accents are light-on-dark by design;
   *  - Login (line 95): the login screen is a fixed-light marketing
   *    surface rendered before theming applies.
   */
  const DARK_EXEMPT = new Set([
    'slate emerald-400|emerald-500',
    'slate emerald-400/80|emerald-500',
    'midnight emerald-400|emerald-500',
    'midnight emerald-400/80|emerald-500',
    'midnight rose-600|rose-50',
    // ErrorBoundary alert icon (components/ErrorBoundary.tsx:68): decorative
    // 20px glyph on a translucent rose wash, 4.42:1 in midnight — same
    // quasi-AA family as the rose-600|rose-50 exemption above.
    'midnight rose-600|rose-500/10',
  ]);

  for (const [key, info] of [...unique.entries()].sort()) {
    const [, rest] = key.split(' '); // first token is the theme
    const [text, bg] = rest.split('|');
    it(`${key} (${info.at.length}×, e.g. ${info.at[0]})`, () => {
      if (DARK_EXEMPT.has(key)) return;
      const p = pairs.find((q) => q.theme === info.theme && q.text === text && q.bg === bg)!;
      const ratio = contrast(p.fg, p.bgHex);
      assert.ok(ratio >= 4.5,
        `${info.at[0]} (${info.theme}): text-${text} on bg-${bg} = ${ratio.toFixed(2)}:1 (< 4.5)`);
    });
  }
});

/**
 * THE RULE: une surface que le thème ne peint pas en sombre garde sa propre
 * couleur de texte.
 *
 * Les deux thèmes sombres repeignent les surfaces chacune à sa façon — slate
 * par sa couche CSS `!important`, midnight par les variantes `dark:` — et une
 * surface que ni l'une ni l'autre ne touche garde le fond du thème clair :
 * feuilles d'impression, écran de connexion, intérieur du widget de chat,
 * surlignage `<mark>`. Ces surfaces sont légitimes ; ce qui ne l'est pas est un
 * texte CLAIR qui atterrit dessus, parce qu'aucun thème n'assombrira le fond
 * au-dessous. C'est exactement la classe du chip blanc sur blanc, et elle était
 * invisible aux autres verrous : `text-white` n'a pas de nuance chiffrée, donc
 * ce n'était même pas un token des manifestes de co-occurrence.
 *
 * La règle est DÉRIVÉE, pas une liste : le fond résolu sous chaque thème sombre
 * est la seul critère (une surface encore claire est une surface non repeinte),
 * et le texte dessus doit passer AA 4.5:1. Un futur panneau clair au texte blanc
 * échoue tout seul ; un panneau qui porte son propre texte passe sans que
 * personne n'ait rien à déclarer.
 */
describe('surfaces non repeintes par le thème : leur texte garde sa propre couleur', () => {
  const { checks, violations } = judgeUnpaintedSurfaces();
  const site = (v: { file: string; line: number }) => `${v.file}:${v.line}`;

  /**
   * Exemptions documentées — aujourd'hui VIDE, et c'est le résultat attendu :
   * le seul cas connu était le texte de l'alerte de l'écran de connexion
   * (`text-rose-600` sur le lavis `rose-50`, 4.28:1). Il a été corrigé à la
   * source (`text-rose-700`, ≥ 4.5:1) plutôt que reconduit : une exemption qui
   * pointe une ligne change de numéro à chaque retouche du fichier, donc une
   * excuse périmée finissait par masquer une violation neuve. La liste reste
   * vérifiée dans les deux sens : une excuse qui ne correspond plus échoue.
   */
  const EXEMPT = new Set<string>([]);

  it('la règle juge vraiment des surfaces non repeintes (anti-vacuité)', () => {
    // Sans ce plancher, un scanner devenu aveugle rendrait une liste de
    // violations vide — donc un vert parfait sur rien.
    assert.ok(checks >= 5, `attendu >= 5 jugements sur surface non repeinte, mesuré ${checks}`);
  });

  it('aucun texte clair sur une surface que le thème sombre n’a pas repeinte', () => {
    assert.deepEqual(
      violations
        .filter((v) => !EXEMPT.has(site(v)))
        .map(
          (v) =>
            `${site(v)} (${v.theme}) text-${v.text} on bg-${v.bg} = ${v.ratio.toFixed(2)}:1`,
        ),
      [],
      'un texte clair sur une surface encore claire ne peut plus passer (aucun thème ne l’assombrira)',
    );
  });

  it('chaque exemption est encore une violation (aucune excuse périmée)', () => {
    for (const s of EXEMPT) {
      assert.ok(violations.some((v) => site(v) === s), `${s} n’est plus en violation : retirez l’exemption`);
    }
  });

  it('la règle MORD : un panneau clair au texte blanc est refusé, celui qui porte son texte passe', () => {
    const FIXTURE = [
      {
        rel: 'Probe.tsx',
        code: [
          '<div className="bg-white text-white">blanc sur blanc</div>',
          '<div className="bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100">repeint</div>',
          '<div className="bg-white text-slate-900">panneau clair assumé</div>',
        ].join('\n'),
      },
    ];
    const probe = judgeUnpaintedSurfaces({ sources: FIXTURE });
    // Deux jugements : la surface peinte en sombre par midnight n'est pas non
    // repeinte, donc elle ne relève pas de cette règle (et pas d'un silence).
    assert.equal(probe.checks, 2, 'la surface repeinte doit être écartée, pas seulement muette');
    assert.deepEqual(
      probe.violations.map((v) => `${v.line} ${v.theme} text-${v.text} on bg-${v.bg}`),
      ['1 midnight text-white on bg-white'],
    );
    assert.ok(probe.violations[0].ratio < 4.5, 'le ratio mesuré doit être sous le seuil');
  });
});

describe('midnight lock: light fills carry a dark: counterpart', () => {
  const EXEMPT_FILES = [
    'components/PayrollView.tsx', // print header
    'components/StudentsView.tsx', // print header + divider
  ];
  // The MODAL scaffold no longer needs exemptions: every modal surface fill
  // lives in src/lib/modalTokens.ts with its `dark:` counterpart in the same
  // string (policed by tests/modal-tokens.test.ts), so the modal entries that
  // used to sit here (AppModals print surfaces, the ticket slip preview, the
  // vendor disabled fields) are structurally paired at the source instead.
  // Remaining: non-modal fixed-light surfaces + the 20%-alpha wash over the
  // themed card (the card's dark surface still shows through).
  /**
   * Les exemptions nomment un FICHIER et un REMPLISSAGE — jamais un numéro de
   * ligne. Mesuré le 2026-09-14 : quatre lignes ajoutées plus haut dans
   * `ExpensesView` ont déplacé la surface exemptée de la ligne 431 à la 435, et
   * l'exemption ne désignait plus rien — le garde est devenu rouge pour une
   * surface qui était légitime, tandis que la MÊME mécanique aurait pu excuser
   * une vraie violation apparue sous le numéro périmé. Une ancre de contenu ne
   * dérive pas ; et pour que son coût soit visible, une exemption qui ne
   * correspond plus à rien échoue (cas dédié plus bas).
   */
  const EXEMPT_FILLS: Record<string, string[]> = {
    'components/Login.tsx': ['bg-rose-50', 'bg-slate-50'],
    'components/FloatingChat.tsx': ['bg-slate-50/50'],
    'components/SharedUi.tsx': ['bg-yellow-200'],
    // 20%-alpha rose washes OVER the themed card (dark surface shows through) —
    // the « année à clore » panel joined the list when the scanner learned to
    // read template TAILS (a chunk written after the first `${…}` used to reach
    // it as ''), not when its colour changed.
    'components/ExpensesView.tsx': ['bg-rose-50/10'],
    'components/ArchivesView.tsx': ['bg-rose-50/20'],
  };

  const gaps = extractMissingDarkBg();
  const exemptBecause = (g: { file: string; fill: string }) =>
    EXEMPT_FILES.includes(g.file) || (EXEMPT_FILLS[g.file] ?? []).includes(g.fill);
  const unexempted = gaps.filter((g) => !exemptBecause(g));
  const matched = gaps.filter(exemptBecause).map((g) => `${g.file}:${g.fill}`);

  it('has no unexempted light fills without a dark: counterpart', () => {
    assert.deepEqual(
      unexempted.map((g) => `${g.file}:${g.line} ${g.fill}`),
      [],
      'light fills missing a dark:bg-* counterpart (the midnight white-chip defect)',
    );
  });

  it('chaque exemption nomme encore une surface RÉELLE — une excuse périmée est un échec', () => {
    const staleFiles = EXEMPT_FILES.filter((f) => !matched.some((m) => m.startsWith(`${f}:`)));
    const staleFills = Object.entries(EXEMPT_FILLS).flatMap(([f, fills]) =>
      fills.filter((fill) => !matched.includes(`${f}:${fill}`)).map((fill) => `${f}:${fill}`),
    );
    assert.deepEqual(
      [...staleFiles, ...staleFills],
      [],
      'exemptions qui ne correspondent plus à aucune surface — elles excuseraient la suivante',
    );
  });
});

/**
 * L'ÉCHELLE DE SURVOL — le verrou des VALEURS, qui remplace celui des recettes.
 *
 * Le défaut d'origine, mesuré : « Exporter les Retards » portait
 * `${card} border ${border} ${text} hover:bg-slate-50`. Cyber Minuit répaint
 * `bg-slate-50` en `#111827` (la carte) — mais la variante compilée s'appelle
 * `.hover\:bg-slate-50:hover`, que ce remap ne couvre pas : au survol la pilule
 * passait à `#F8FAFC` pendant que l'encre `#F9FAFB` restait en place. Blanc sur
 * blanc, lettres disparues.
 *
 * Le verrou qui poursuivait ces paires (`hover:…` sans `dark:hover:…`) a été
 * RETIRÉ avec son sujet : la migration a remplacé chaque recette par un CRAN
 * (`currentTheme.hoverSurface`, …), dont la VALEUR vit par thème dans
 * src/themes/state-hover.css — et `scripts/check-state-hover.mjs` fait échouer
 * toute recette écrite à la main. Il ne reste donc plus de paires à surveiller :
 * il reste des VALEURS, et c'est ici qu'on les juge.
 *
 * La question est la même qu'avant, posée au bon endroit : l'encre du thème
 * reste-t-elle lisible SUR la surface de survol de ce thème-là ? Chaque valeur
 * est composée sur la carte du thème puis mesurée à AA 4,5:1 — et les deux
 * thèmes sombres doivent en plus porter un VOILE (une teinte claire opaque y
 * serait exactement le défaut qu'on a payé).
 */
describe('échelle de survol : les valeurs par thème tiennent la promesse', () => {
  const CODE = CSS_TEXT.replace(/\/\*[\s\S]*?\*\//g, ' ');

  /** Les variables `--state-*` publiées par chaque bloc de sélecteur du corpus. */
  const stateVarsBySelector = (() => {
    const map = new Map<string, Record<string, string>>();
    for (const block of CODE.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const decls: Record<string, string> = {};
      for (const m of block[2].matchAll(/(--state-[a-z-]+)\s*:\s*([^;]+);/g)) decls[m[1]] = m[2].trim();
      if (Object.keys(decls).length === 0) continue;
      for (const seg of block[1].split(',')) {
        const key = seg.trim();
        if (!/^\.theme-[a-z]+$|^:root$/.test(key)) continue;
        map.set(key, { ...(map.get(key) ?? {}), ...decls });
      }
    }
    return map;
  })();

  const varsOf = (theme: string) => stateVarsBySelector.get(`.theme-${theme}`) ?? {};
  const rootVars = () => stateVarsBySelector.get(':root') ?? {};

  /**
   * L'encre de corps de chaque thème — la source est nommée, et le hex doit
   * TOUJOURS se lire dans le corpus : si un thème change d'encre, ce test tombe
   * et force une re-mesure, au lieu de valider une table qu'on a oubliée.
   * (Les thèmes clairs passent par `resolve`, donc par les remaps réels.)
   */
  const INK: Record<string, { ink: string; from: string }> = {
    navy: { ink: resolve('navy', 'text', 'slate-800'), from: 'corps slate-800' },
    emerald: { ink: resolve('emerald', 'text', 'slate-800'), from: 'corps slate-800' },
    cream: { ink: '#1A1A1A', from: 'src/themes/overrides.css — .theme-cream { color: #1A1A1A }' },
    bordeaux: { ink: resolve('bordeaux', 'text', 'slate-800'), from: 'corps slate-800' },
    slate: { ink: '#F8FAFC', from: 'src/themes/overrides.css — .theme-slate { color: #F8FAFC }' },
    midnight: { ink: '#F9FAFB', from: 'src/themes/midnight.css — .theme-midnight { color: #F9FAFB }' },
  };
  const CTX: Record<string, string> = {
    navy: CARD.navy, emerald: CARD.emerald, cream: CARD.cream, bordeaux: CARD.bordeaux,
    slate: DARK_CARD.slate, midnight: DARK_CARD.midnight,
  };
  const ALL_THEMES = [...LIGHT_THEMES, 'slate', 'midnight'];

  /** Une couleur du corpus posée sur la carte du thème, en hexa opaque. */
  const overCard = (value: string, card: string): string => {
    const rgba = value.match(/^rgba\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*\)$/);
    if (!rgba) return value;
    const hex = '#' + rgba.slice(1, 4).map((c) => Math.round(Number(c)).toString(16).padStart(2, '0')).join('');
    return composite(hex, Number(rgba[4]), card);
  };

  it('le repli du thème par défaut publie TOUT le contrat, et chaque cran existe', () => {
    for (const name of STATE_VARS) {
      assert.ok(rootVars()[name], `:root doit publier ${name} (le repli du thème par défaut)`);
    }
    for (const cls of STATE_HOVER_CLASSES) {
      assert.ok(
        new RegExp(`\\.${cls}(?![\\w-])`).test(CODE),
        `la classe .${cls} est promise par l’échelle et doit exister dans le corpus`,
      );
    }
  });

  it('chaque VALEUR du contrat vient du corpus (aucun jeton simulé côté JS)', () => {
    // Les jetons de `useTheme` sont des noms de classes : rien à mesurer là-bas.
    // Ce qui se mesure, c'est que les valeurs existent bien quelque part dans le
    // CSS — un jeton dont la variable n'est jamais publiée ne peint rien.
    for (const name of STATE_VARS) {
      assert.ok(
        new RegExp(`${name}\\s*:`).test(CODE),
        `${name} doit être déclarée dans src/themes/state-hover.css`,
      );
    }
  });

  it('les deux thèmes sombres posent un VOILE, jamais une teinte claire opaque', () => {
    for (const theme of ['slate', 'midnight']) {
      const value = varsOf(theme)['--state-hover'];
      assert.ok(value, `${theme} doit publier son propre --state-hover`);
      const rgba = value.match(/^rgba\(255,\s*255,\s*255,\s*([\d.]+)\)$/);
      assert.ok(rgba, `${theme} : un voile BLANC translucide (mesuré : ${value})`);
      const alpha = Number(rgba[1]);
      assert.ok(alpha > 0 && alpha <= 0.12, `${theme} : voile mesuré ${alpha}, attendu dans ]0, 0.12]`);
    }
  });

  it('le thème crème garde son survol CHAUD (la raison d’être de l’échelle)', () => {
    const cream = varsOf('cream');
    assert.equal(cream['--state-hover'], '#FAF7F0', 'la rangée crème reste crème au survol');
    assert.equal(cream['--state-hover-solid'], '#E5DEC9', 'et le remplissage suit sa palette');
    assert.doesNotMatch(String(cream['--state-hover']), /^#F8FAFC$/i, 'pas le gris froid navy');
  });

  it('le survol d’une rangée reste LISIBLE sur la carte de chacun des six thèmes', () => {
    for (const theme of ALL_THEMES) {
      const { ink, from } = INK[theme];
      assert.ok(CODE.includes(ink), `l’encre ${ink} de ${theme} doit venir du corpus (${from})`);
      const hover = varsOf(theme)['--state-hover'] ?? rootVars()['--state-hover'];
      const surface = overCard(hover, CTX[theme]);
      const ratio = contrast(ink, surface);
      assert.ok(
        ratio >= 4.5,
        `${theme} : l’encre ${ink} sur la surface de survol ${surface} mesure ${ratio.toFixed(2)}:1 ` +
          '(le défaut payé était exactement ça : une surface claire sous une encre claire)',
      );
    }
  });

  it('le cran d’ALERTE reste lisible, encre ET surface, sur chacun des six thèmes', () => {
    for (const theme of ALL_THEMES) {
      const vars = varsOf(theme);
      const surface = overCard(vars['--state-alert-hover'] ?? rootVars()['--state-alert-hover'], CTX[theme]);
      const ink = vars['--state-alert-ink'] ?? rootVars()['--state-alert-ink'];
      const ratio = contrast(ink, surface);
      assert.ok(ratio >= 4.5, `${theme} : l’encre d’alerte ${ink} sur ${surface} mesure ${ratio.toFixed(2)}:1`);
    }
  });

  it('chaque cran est exposé par un jeton — sauf celui dont l’exception est NOMMÉE', () => {
    // Un cran sans jeton est un cran qu'aucun composant THÉMÉ ne peut demander :
    // il ne s'écrit alors qu'en clair, dans un chrome qui n'a pas de thème. C'est
    // le cas d'un seul (`state-hover-deep`, l'écran de connexion) — et c'est la
    // liste des exceptions qui le dit, pas un commentaire. Un cran neuf sans jeton
    // tombe donc ici, à moins qu'on l'inscrive en connaissance de cause.
    const tokens = new Set(Object.values(STATE_HOVER_TOKENS));
    const exceptions = Object.keys(STATE_HOVER_CLASSES_WITHOUT_TOKEN);
    for (const cls of STATE_HOVER_CLASSES) {
      if (exceptions.includes(cls)) continue;
      assert.ok(
        tokens.has(cls),
        `le cran ${cls} doit être exposé par un jeton de currentTheme (le type est TOTAL : useTheme doit le poser)`,
      );
    }
    for (const cls of exceptions) {
      assert.ok(STATE_HOVER_CLASSES.includes(cls), `${cls} est déclaré sans jeton mais n’est pas un cran de l’échelle`);
      assert.ok(!tokens.has(cls), `${cls} est listé sans jeton ET exposé : l’exception mentirait`);
    }
    assert.equal(
      Object.values(STATE_HOVER_TOKENS).length,
      STATE_HOVER_CLASSES.length - exceptions.length,
      'le nombre de jetons est celui des crans, moins les exceptions nommées',
    );
  });

  it('les cinq valeurs des surfaces HORS thème sont posées UNE fois, et portent celles des recettes retirées', () => {
    // Ces cinq-là décrivent des surfaces dont l'identité ne dépend PAS du thème :
    // un chrome toujours sombre (l'écran de connexion, le rail) et un aplat
    // d'accent (le bandeau payé, la fiche parent). Les déclarer par thème serait
    // six fois la même valeur et six occasions de les faire diverger ; et leurs
    // valeurs sont celles des recettes qu'elles remplacent — c'est ce qui rend la
    // migration mesurable (aucun pixel ne bouge) — qu'AUCUN remap de thème ne
    // couvrait (vérifié : src/themes ne remappe ni `bg-slate-800`, ni
    // `hover:bg-slate-900`, ni `hover:bg-white/90`, ni les roses 500/10 et /30).
    const FIXED: Record<string, string> = {
      '--state-hover-deep': '#0F172A', // était `hover:bg-slate-900` (CTA de connexion)
      '--state-hover-clear': 'rgba(255, 255, 255, 0.90)', // était `hover:bg-white/90`
      '--state-alert-dark': 'rgba(244, 63, 94, 0.10)', // était `hover:bg-rose-500/10` (rail)
      '--state-alert-dark-ink': '#FDA4AF', // était `hover:text-rose-300` (encre levée du rail)
      '--state-alert-plate': 'rgba(244, 63, 94, 0.30)', // était `hover:bg-rose-500/30` (aplat)
    };
    for (const [name, value] of Object.entries(FIXED)) {
      assert.equal(
        rootVars()[name],
        value,
        `:root doit publier ${name} avec la valeur de la recette qu'il remplace`,
      );
    }
    for (const theme of ALL_THEMES) {
      for (const name of Object.keys(FIXED)) {
        assert.equal(
          varsOf(theme)[name],
          undefined,
          `.theme-${theme} ne doit PAS republier ${name} : cette surface ne suit pas le thème`,
        );
      }
    }
  });

  it('les crans des surfaces hors thème emploient le mécanisme qui leur revient (surface ou calque, encre ou non)', () => {
    const rule = (selector: string) => {
      const m = CODE.match(new RegExp(`${selector.replace(/[.:]/g, '\\$&')}\\s*\\{([^}]+)\\}`));
      assert.ok(m, `règle introuvable : ${selector}`);
      return m[1];
    };
    // Un contrôle au repos BLANC OPAQUE : une SURFACE (le repos est connu) ; le
    // voile, lui, serait invisible sur du blanc.
    assert.match(rule('.state-hover-clear:hover'), /background-color:/);
    assert.doesNotMatch(rule('.state-hover-clear:hover'), /background-image:/);
    // Un contrôle neutre DÉJÀ REMPLI sur un chrome fixe : une surface aussi.
    assert.match(rule('.state-hover-deep:hover'), /background-color:/);
    // Sur le rail comme sur l'aplat d'accent, le repos n'est PAS une teinte de
    // thème : le voile s'AJOUTE.
    for (const cls of ['.state-alert-dark:hover', '.state-alert-plate:hover']) {
      assert.match(rule(cls), /background-image:/, `${cls} doit poser un CALQUE`);
      assert.doesNotMatch(rule(cls), /background-color:/, `${cls} ne remplace pas la surface du bandeau`);
    }
    // L'alerte du rail emmène ses DEUX moitiés (c'était l'erreur du cran de page :
    // une pastille pâle sous une encre profonde) ; celle de l'aplat n'en prend
    // AUCUNE, le bandeau portant déjà son encre.
    assert.match(rule('.state-alert-dark:hover'), /color:/);
    assert.doesNotMatch(rule('.state-alert-plate:hover'), /color:/);
  });

  it('l’encre du cran d’alerte du RAIL reste lisible sur un chrome toujours sombre', () => {
    // Le rail est sombre dans les six thèmes, mais pas de la même teinte : l'encre
    // levée doit tenir AA sur les deux (Ardoise Sombre est le plus clair), voile
    // rose compris — c'est exactement ce que le cran de PAGE ne pouvait pas dire.
    const ink = rootVars()['--state-alert-dark-ink'];
    const veil = rootVars()['--state-alert-dark'];
    const m = veil.match(/^rgba\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*\)$/);
    assert.ok(m, `le voile d'alerte du rail doit être un rgba() mesurable (lu : ${veil})`);
    for (const rail of ['#090D16', '#0F172A', '#1E293B']) {
      const rose = '#' + m.slice(1, 4).map((c) => Math.round(Number(c)).toString(16).padStart(2, '0')).join('');
      const surface = composite(rose, Number(m[4]), rail);
      const ratio = contrast(ink, surface);
      assert.ok(
        ratio >= 4.5,
        `le rail ${rail} + le voile donne ${surface} : l'encre ${ink} y mesure ${ratio.toFixed(2)}:1`,
      );
    }
  });

  it('l’accent et l’alerte portent l’encre AVEC la surface, les crans neutres non', () => {
    const rule = (selector: string) => {
      const m = CODE.match(new RegExp(`${selector.replace(/[.:]/g, '\\$&')}\\s*\\{([^}]+)\\}`));
      assert.ok(m, `règle introuvable : ${selector}`);
      return m[1];
    };
    // La raison d'être de ces deux crans : deux classes à écrire, c'était deux
    // occasions d'en oublier une — et l'oubli se paie en contraste.
    assert.match(rule('.state-accent-hover:hover'), /background-color:/);
    assert.match(rule('.state-accent-hover:hover'), /color:/);
    assert.match(rule('.state-alert-hover:hover'), /background-color:/);
    assert.match(rule('.state-alert-hover:hover'), /color:/);
    // Les crans NEUTRES ne touchent pas à l'encre : l'encre de l'élément est
    // celle de son composant (une rangée garde son texte, une icône sa teinte).
    for (const cls of ['.state-hover:hover', '.state-hover-solid:hover', '.state-hover-strong:hover']) {
      assert.doesNotMatch(
        rule(cls),
        /(?:^|[\s{;])color:/,
        `${cls} ne doit pas repeindre l’encre (une rangée garde son texte)`,
      );
    }
  });
});
/**
 * LES ENCRES DE SURVOL — le second temps du verrou des paires.
 *
 * Le remplissage était verrouillé (« tout remplissage clair porte sa
 * contrepartie sombre », « toute surface non repeinte garde son propre texte »),
 * l'ENCRE ne l'était pas : `scripts/check-state-hover.mjs` tolère une encre
 * NEUTRE au survol parce que l'échelle n'a pas de cran pour elle. Tolérée — mais
 * pas mesurée. Or une encre de survol est résolue par le navigateur depuis une
 * classe de variante compilée (`.hover\:text-slate-600:hover`), qu'aucune couche
 * de thème ne nomme.
 *
 * CE QUE LE MOTEUR A DIT, avant qu'un modèle soit écrit (sonde Chrome, 2026-10-14,
 * les formes rejouées une à une) :
 *   • un élément dont l'encre de REPOS est une classe que le thème force
 *     (`color: … !important`, voir `forcedRestInk`) garde cette couleur SOUS LE
 *     CURSEUR : `text-slate-400 hover:text-slate-600` lit rgb(169,180,196) au
 *     repos ET au survol — le `!important` bat la variante compilée, qui est un
 *     utilitaire en couche. L'encre de survol y est INERTE ;
 *   • sans cette encre forcée, la variante S'APPLIQUE : `hover:text-slate-600`
 *     seul, ou posé sur un `text-slate-300`/`text-[#A9B4C4]` (le `muted` du
 *     thème, une couleur arbitraire que rien ne force), peint bien slate-600
 *     sous le curseur — 2,34:1 sur la carte de Cyber Minuit, 1,37:1 sur celle
 *     d'Ardoise : l'affordance s'efface au moment où on la pointe ;
 *   • et quand la contrepartie est là, c'est ELLE qui gagne (mesuré :
 *     oklch(0.929 …) = slate-200, lisible).
 *
 * DEUX CONSÉQUENCES, et chacune est un choix :
 *   1. la règle lit le masque dans le corpus (`forcedRestInk`) et NE JUGE PAS une
 *      encre masquée : un défaut qui ne se rend pas n'est pas un défaut, et
 *      signaler vingt sites où rien ne change serait pire que pas de modèle. Le
 *      masque est propre à chaque thème — Ardoise ne force que slate-400/500,
 *      Cyber Minuit force aussi 600/700 — donc le même élément peut être inerte
 *      dans un thème et vivant dans l'autre, et la règle juge chaque thème sur
 *      SA liste (`text-slate-600 hover:text-slate-800` en est le cas d'école :
 *      inerte en Cyber Minuit, 1,41:1 en Ardoise) ;
 *   2. les onze correctifs de ce commit ne sont pas cosmétiques : ce sont les
 *      sites où la sonde a montré que l'encre se rend (les `hover:text-slate-600`
 *      posés sur le `muted` arbitraire du thème, les deux boutons à encre de
 *      repos `text-slate-600`). Les huit autres — encre de repos forcée dans les
 *      DEUX thèmes — ont été laissés SANS contrepartie : leur encre ne se rend
 *      pas, et le jour où un thème cesserait de la forcer, cette règle les
 *      rallumerait d'elle-même (le masque est recalculé à chaque exécution).
 */
describe('encres de survol : AA sur la surface que le thème peint sous le curseur', () => {
  const scan = judgeHoverInk();

  it('aucune encre de survol sous 4,5:1, dans aucun des deux thèmes sombres', () => {
    assert.deepEqual(
      scan.violations.map(
        (v) => `${v.file}:${v.line} [${v.theme}] ${v.ink} (${v.inkHex}) sur ${v.surface} (${v.surfaceHex}) = ${v.ratio.toFixed(2)}:1`,
      ),
      [],
      'une encre de survol qui se rend doit porter sa contrepartie sombre (dark:hover:text-*)',
    );
  });

  it('le balayage LIT vraiment des encres — un scan vide n’est pas un vert', () => {
    // Mesuré le 2026-10-14 : 50 jugements (25 empreintes × 2 thèmes), 28 encre(s)
    // MASQUÉES par un `!important` de thème. Les planchers sont sous les mesures
    // pour ne pas casser au moindre remaniement, mais ils tombent si le motif de
    // lecture disparaît (racine déplacée, regex cassée) : c'est le seul état que
    // ce cas existe pour refuser.
    assert.ok(scan.checks >= 40, `jugements mesurés : ${scan.checks} (attendu ≥ 40)`);
    assert.ok(scan.masked.length >= 20, `encres masquées mesurées : ${scan.masked.length} (attendu ≥ 20)`);
    for (const theme of ['slate', 'midnight']) {
      assert.ok(scan.subjects.some((s) => s.includes(` ${theme} `)), `${theme} doit être jugé, pas seulement listé`);
    }
  });

  it('la règle MORD : une encre sombre au survol qui SE REND, sans contrepartie', () => {
    // La forme mesurée en moteur : aucune encre de repos forcée, donc la variante
    // s'applique (rgb depuis oklch(0.446 0.043 257.281) = slate-600).
    const probe = judgeHoverInk({
      sources: [{ rel: 'Probe.tsx', code: '<div className="hover:text-slate-600">icone</div>' }],
    });
    assert.equal(probe.checks, 2, 'les deux thèmes sombres sont jugés');
    assert.deepEqual(
      probe.violations.map((v) => `${v.theme} ${v.ink} ${v.inkHex} ${v.ratio < 4.5}`),
      ['slate slate-600 #475569 true', 'midnight slate-600 #475569 true'],
    );
    assert.ok(probe.violations.every((v) => v.counterpart === null), 'aucune contrepartie ne doit être inventée');
  });

  it('le MASQUE mesuré : une encre de repos forcée rend l’encre de survol INERTE — et c’est par thème', () => {
    // Forme A (sonde) : `text-slate-400` est forcé dans les DEUX thèmes sombres.
    const forcedBoth = judgeHoverInk({
      sources: [{ rel: 'Probe.tsx', code: '<div className="text-slate-400 hover:text-slate-600">icone</div>' }],
    });
    assert.deepEqual(
      { checks: forcedBoth.checks, masked: forcedBoth.masked.length, violations: forcedBoth.violations },
      { checks: 0, masked: 2, violations: [] },
      'rien ne se rend : la règle doit le DIRE (masqué), pas le juger',
    );

    // Forme I/J (sonde) : slate-600 est forcé par Cyber Minuit, pas par Ardoise.
    const onlyMidnight = judgeHoverInk({
      sources: [{ rel: 'Probe.tsx', code: '<div className="text-slate-600 hover:text-slate-800">lien</div>' }],
    });
    assert.equal(onlyMidnight.masked.length, 1, 'Cyber Minuit force slate-600 : l’encre y est inerte');
    assert.deepEqual(
      onlyMidnight.violations.map((v) => `${v.theme} ${v.ink} ${v.ratio < 4.5}`),
      ['slate slate-800 true'],
      'Ardoise ne force PAS slate-600 : l’encre s’y rend, donc elle s’y juge',
    );
  });

  it('la contrepartie acquitte — même écrite APRÈS une interpolation', () => {
    const probe = judgeHoverInk({
      sources: [
        {
          rel: 'Probe.tsx',
          code: '<div className={`text-slate-300 hover:text-slate-600 ${token} dark:hover:text-slate-200`}>icone</div>',
        },
      ],
    });
    assert.equal(probe.checks, 2, 'l’élément est jugé');
    assert.deepEqual(probe.violations, [], 'une contrepartie séparée par une interpolation est la même encre');
  });

  it('la contrepartie SANS échelon (white) compte — c’est la forme des onglets du dossier parent', () => {
    const probe = judgeHoverInk({
      sources: [
        {
          rel: 'Probe.tsx',
          code: '<button className="text-slate-300 hover:text-slate-900 dark:hover:text-white">trier</button>',
        },
      ],
    });
    assert.equal(probe.checks, 2);
    assert.deepEqual(probe.violations, [], 'un `dark:hover:text-white` est une contrepartie comme une autre');
  });

  it('une contrepartie ILLISIBLE est refusée à son tour — elle est l’encre rendue', () => {
    const probe = judgeHoverInk({
      sources: [
        { rel: 'Probe.tsx', code: '<div className="text-slate-300 hover:text-slate-600 dark:hover:text-slate-700">icone</div>' },
      ],
    });
    assert.equal(probe.checks, 2);
    assert.deepEqual(
      probe.violations.map((v) => `${v.theme} ${v.ink} ${v.counterpart} ${v.ratio < 4.5}`),
      ['slate slate-700 slate-700 true', 'midnight slate-700 slate-700 true'],
      'la contrepartie gagne, donc c’est elle qui doit tenir AA',
    );
  });

  it('la surface est LUE, pas supposée : une encre sombre sur un hover:bg-white reste légitime', () => {
    const probe = judgeHoverInk({
      sources: [
        {
          rel: 'Probe.tsx',
          code: [
            '<div className="text-slate-300 hover:text-slate-600 hover:bg-white">panneau blanc assumé</div>',
            '<div className="text-slate-300 hover:text-slate-600">icône sur la carte du thème</div>',
          ].join('\n'),
        },
      ],
    });
    assert.equal(probe.checks, 4, 'les deux éléments sont jugés sous les deux thèmes');
    assert.deepEqual(
      probe.violations.map((v) => v.line),
      [2, 2],
      'seule la carte du thème est peinte sous l’encre : le panneau blanc ne relève pas de cette règle',
    );
    assert.ok(probe.violations.every((v) => v.ratio < 4.5));
  });

  it('la branche claire d’un ternaire n’est pas jugée — et sa sœur l’est', () => {
    const lightOnly = judgeHoverInk({
      sources: [
        {
          rel: 'Probe.tsx',
          code: '<div className={theme === \'cream\' ? \'text-slate-300 hover:text-slate-600\' : \'text-slate-300\'}>icone</div>',
        },
      ],
    });
    // Refus de l'approbation silencieuse : la branche ne rend QUE dans un thème
    // clair, donc elle n'est pas jugée — et le compte le dit.
    assert.deepEqual({ checks: lightOnly.checks, violations: lightOnly.violations }, { checks: 0, violations: [] });

    const darkBranch = judgeHoverInk({
      sources: [
        {
          rel: 'Probe.tsx',
          code: '<div className={isDark ? \'text-slate-300 hover:text-slate-600\' : \'text-slate-300\'}>icone</div>',
        },
      ],
    });
    assert.equal(darkBranch.checks, 2, 'la branche SOMBRE, elle, est rendue et jugée');
    assert.equal(darkBranch.violations.length, 2);
  });
});
