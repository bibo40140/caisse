// renderer/utils/smartSearch.js
// Recherche hybride : normalisation FR + alias + exact/prefix/substr + fuzzy (Levenshtein)

export function createSmartSearch(options = {}) {
  const cfg = {
    accentInsensitive: true,
    typoTolerance: 2,
    minQueryLen: 1,
	minTokenLen: 2,

    aliases: {},
    stopwords: [],
    getBoost: null, // (item) => number, ex: boost stock/popularité
    fields: null,   // (item) => { text: string, barcode?: string }
    ...options
  };

  const state = {
    items: [],
    index: [] // { id, text, tokens, barcode, ref }
  };

  // ---------- Utils ----------
  const stripAccents = (s) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const normalize = (s) => {
    if (!s) return '';
    let t = String(s).toLowerCase();
    t = t.replace(/œ/g, 'oe'); // FR
    if (cfg.accentInsensitive) t = stripAccents(t);
    t = t.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    return t;
  };

 const tokenize = (s) => {
  if (!s) return [];
  const toks = s.split(' ').filter(Boolean);
  const sw = new Set(cfg.stopwords.map(normalize));
  return toks.filter(tok => tok && !sw.has(tok) && tok.length >= cfg.minTokenLen);
};

  const unique = (arr) => Array.from(new Set(arr));

  // Levenshtein optimisé (typoTolerance petite)
  function levenshtein(a, b, max = 3) {
    const al = a.length, bl = b.length;
    if (Math.abs(al - bl) > max) return max + 1;
    const v0 = new Array(bl + 1);
    const v1 = new Array(bl + 1);
    for (let i = 0; i <= bl; i++) v0[i] = i;
    for (let i = 0; i < al; i++) {
      v1[0] = i + 1;
      const ca = a.charCodeAt(i);
      for (let j = 0; j < bl; j++) {
        const cost = (ca === b.charCodeAt(j)) ? 0 : 1;
        v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
      }
      for (let j = 0; j <= bl; j++) v0[j] = v1[j];
    }
    return v1[bl];
  }

  // Génère variantes singulier/pluriel très simples (FR basique)
  function variants(token) {
    const v = new Set([token]);
    if (token.endsWith('s')) v.add(token.slice(0, -1));
    else v.add(token + 's');
    if (token.endsWith('x')) v.add(token.slice(0, -1));
    return Array.from(v);
  }

  // Étend les tokens via alias + variantes
  function expandTokens(tokens) {
    const out = new Set();
    for (const t of tokens) {
      out.add(t);
      for (const v of variants(t)) out.add(v);
      const al = cfg.aliases[t];
      if (al && al.length) {
        for (const phrase of al) {
          const toks = tokenize(normalize(phrase));
          toks.forEach(tt => {
            out.add(tt);
            for (const vv of variants(tt)) out.add(vv);
          });
        }
      }
    }
    return Array.from(out);
  }

  // ---------- Index ----------
  function indexItems(items) {
    state.items = items || [];
    state.index = state.items.map((it, idx) => {
      const f = cfg.fields ? cfg.fields(it) : defaultFields(it);
      const textNorm = normalize(f.text);
      return {
        id: idx,
        ref: it,
        text: textNorm,
        tokens: tokenize(textNorm),
        barcode: f.barcode ? String(f.barcode) : ''
      };
    });
  }

  function defaultFields(item) {
    // Fallback générique pour Produits (adapte si besoin)
    const parts = [
      item.nom,
      item.famille_effective_nom,
      item.categorie_effective_nom,
      item.fournisseur_nom,
      ...(item.tags || [])
    ].filter(Boolean);
    return {
      text: parts.join(' '),
      barcode: item.code_barre || item.codebarres || item.ean || ''
    };
  }

  // ---------- Scoring ----------
function scoreItem(q, qTokens, item) {
  let base = 0;

  // 1) Barcode
  if (item.barcode) {
    if (item.barcode === q) base += 100;
    else if (item.barcode.startsWith(q)) base += 90;
  }

  // 2) Match phrase (éviter les req. trop courtes)
  const qn = normalize(q);
  if (qn && qn.length >= 3 && item.text.includes(qn)) base += 50;

  // 3) Token matching
  for (const qt of qTokens) {
    if (!qt) continue;

    // exact
    if (item.tokens.includes(qt)) { base += 11; continue; }

    // prefix
    let matched = false;
    for (const tok of item.tokens) {
      if (tok.startsWith(qt)) { base += 9; matched = true; break; }
    }
    if (matched) continue;

    // substring
    for (const tok of item.tokens) {
      if (qt.length >= 3 && tok.includes(qt)) { base += 7; matched = true; break; }
    }
    if (matched) continue;

    // fuzzy (éviter sur tokens très courts)
    const tol = Math.max(0, cfg.typoTolerance|0);
    if (tol > 0 && qt.length >= 3) {
      let best = tol + 1;
      for (const tok of item.tokens) {
        const d = levenshtein(qt, tok, tol);
        if (d < best) best = d;
        if (best === 1) break;
      }
      if (best <= tol) {
        base += (5 - (best - 1) * 2);
      }
    }
  }

  // 4) Boost uniquement si on a un match réel
  let boost = 0;
  if (typeof cfg.getBoost === 'function') {
    boost = Number(cfg.getBoost(item.ref) || 0);
  }

  return base > 0 ? base + boost : 0;
}


  // ---------- API ----------
function search(query, { limit = 50 } = {}) {
  if (!query || query.length < cfg.minQueryLen) return [];

  const qRaw = String(query).trim();
  const qn = normalize(qRaw);
  const qTokens = expandTokens(tokenize(qn));

  // si pas de tokens et pas un barcode plausible ⇒ pas de résultats
  const looksLikeBarcode = /^\d{5,}$/.test(qRaw);
  if (qTokens.length === 0 && !looksLikeBarcode) return [];

  const scored = state.index.map(it => ({
    ref: it.ref,
    score: scoreItem(qRaw, qTokens, it)
  }));

  scored.sort((a,b) => b.score - a.score);
  return (limit > 0 ? scored.slice(0, limit) : scored)
    .filter(x => x.score > 0)
    .map(x => ({ item: x.ref, score: x.score }));
}


  return {
    index: indexItems,
    search,
    setAliases(aliases) { cfg.aliases = aliases || {}; },
    setOptions(next) { Object.assign(cfg, next || {}); }
  };
}
