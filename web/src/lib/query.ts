/** A boolean search query (PubMed or Europe PMC syntax), read back as plain lines: each line one concept, its
 *  synonyms joined with "or", the lines joined with "and". The planner writes these queries for the search
 *  engine; this is the same query for the person reading it. */

export interface Term { text: string; field: string }
export interface Clause { not: boolean; terms: Term[] }

const OPERATOR = /^(AND|OR|NOT)$/;

type Node = { kind: "term"; term: Term } | { kind: "and" | "or"; items: Node[] } | { kind: "not"; item: Node };

// PubMed's field tags, by what a reader needs to know. Title/abstract and all-fields are the default reading
// of a term and get no label.
const FIELDS: Record<string, string> = {
  tiab: "", tw: "", "all fields": "", all: "", "text word": "", "title/abstract": "",
  ti: "in title", title: "in title", ab: "in abstract", abstract: "in abstract",
  mesh: "MeSH", mh: "MeSH", "mesh terms": "MeSH", "mesh:noexp": "MeSH", "mh:noexp": "MeSH",
  majr: "MeSH, major", "mesh major topic": "MeSH, major",
  nm: "MeSH concept", "supplementary concept": "MeSH concept",
  pt: "study type", "publication type": "study type",
  dp: "published", pdat: "published", "date - publication": "published",
  la: "language", lang: "language", au: "author", author: "author", ta: "journal", journal: "journal",
  sb: "subset", subset: "subset",
};

export const FIELD_HELP: Record<string, string> = {
  MeSH: "A MeSH heading: matches papers indexed under this subject, whatever words they use",
  "MeSH, major": "A MeSH heading that is a main topic of the paper",
  "MeSH concept": "A MeSH supplementary concept, usually a drug or chemical",
  "study type": "PubMed's publication type, e.g. randomized controlled trial",
};

/** The query as concept lines, or null when it is not plain boolean syntax (the caller shows it raw). */
export function readQuery(query: string): Clause[] | null {
  const tokens = tokenize(query);
  if (!tokens) return null;
  let at = 0;

  // PubMed applies operators left to right; only parentheses group. Adjacent terms are an AND.
  const sequence = (): Node | null => {
    let node = unit();
    if (!node) return null;
    while (at < tokens.length && tokens[at] !== ")") {
      const op = OPERATOR.test(tokens[at]) ? tokens[at++] : "AND";
      const next = unit();
      if (!next) return null;
      node = op === "OR" ? join("or", node, next)
        : join("and", node, op === "NOT" ? { kind: "not", item: next } : next);
    }
    return node;
  };
  const unit = (): Node | null => {
    const token = tokens[at++];
    if (token === undefined || token === ")" || OPERATOR.test(token)) return null;
    if (token === "(") {
      const inner = sequence();
      return inner && tokens[at++] === ")" ? inner : null;
    }
    // A bare ":" or "-" is range or proximity syntax, which does not read as a list of terms.
    return /[\p{L}\p{N}]/u.test(token) ? { kind: "term", term: parseTerm(token) } : null;
  };

  const root = sequence();
  if (!root || at !== tokens.length) return null;
  const clauses: Clause[] = [];
  for (const node of root.kind === "and" ? root.items : [root]) {
    const not = node.kind === "not";
    const terms = synonyms(not ? node.item : node);
    if (!terms) return null;
    clauses.push({ not, terms });
  }
  return clauses;
}

function join(kind: "and" | "or", a: Node, b: Node): Node {
  const items = (n: Node) => (n.kind === kind ? n.items : [n]);
  return { kind, items: [...items(a), ...items(b)] };
}

/** A clause's terms when it is one term or an OR of terms; anything deeper does not read as one line. */
function synonyms(node: Node): Term[] | null {
  if (node.kind === "term") return [node.term];
  if (node.kind !== "or") return null;
  const terms = node.items.flatMap((n) => (n.kind === "term" ? [n.term] : []));
  return terms.length === node.items.length ? terms : null;
}

/** Quoted phrases, bare phrases (adjacent words are one phrase), parentheses and operators; a [tag] stays on
 *  the term it follows. */
function tokenize(query: string): string[] | null {
  const tokens: string[] = [];
  const re = /\s*(?:([()])|("[^"]*"(?:\s*\[[^\]]*\])?)|([^\s()"[\]]+(?:\s*\[[^\]]*\])?))/y;
  const text = query.trim();
  while (re.lastIndex < text.length) {
    const m = re.exec(text);
    if (!m) return null;
    const word = m[3];
    const last = tokens[tokens.length - 1];
    // "weight loss[tiab]" is one term: glue a bare word onto the bare words before it.
    if (word && !OPERATOR.test(word) && last && isBare(last)) tokens[tokens.length - 1] = `${last} ${word}`;
    else tokens.push(m[1] ?? m[2] ?? word);
  }
  return tokens;
}

function isBare(token: string): boolean {
  return !/^[()"]/.test(token) && !OPERATOR.test(token) && !token.endsWith("]");
}

function parseTerm(token: string): Term {
  const m = /^(.*?)\s*\[([^\]]*)\]$/.exec(token);
  const text = (m ? m[1] : token).replace(/^"|"$/g, "").trim();
  const tag = m ? m[2].trim().toLowerCase().replace(/:~\d+$/, "") : "";
  const field = tag in FIELDS ? FIELDS[tag] : tag;
  // A date range reads as one: 2020:2024[dp] → 2020–2024.
  return { text: field === "published" ? text.replace(/\s*:\s*/, "–") : text, field };
}
