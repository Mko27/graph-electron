/**
 * Query builders for the schema panel's click-to-insert shortcuts.
 *
 * Two things were wrong with the previous inline versions: labels were
 * interpolated raw, so an apostrophe, space or backtick in an ordinary label
 * produced a broken query; and only Gremlin and Cypher had a branch, so
 * clicking a schema label did nothing for the other four dialects.
 */

/** Escape a label for a single-quoted Gremlin string. */
export function gremlinString(label: string): string {
  return `'${label.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Quote a Cypher identifier. Plain identifiers pass through; anything else is
 * backtick-quoted with inner backticks doubled, per the Cypher rules.
 */
export function cypherIdent(label: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) return label;
  return `\`${label.replace(/`/g, '``')}\``;
}

/** Single-quoted string literal for the SQL-ish dialects. */
export function sqlString(label: string): string {
  return `'${label.replace(/'/g, "''")}'`;
}

/** A "show me 25 of these vertices" query, or null if the dialect has none. */
export function vertexQueryFor(dialect: string, label: string): string | null {
  switch (dialect) {
    case 'gremlin':
      return `g.V().hasLabel(${gremlinString(label)}).limit(25)`;
    case 'cypher':
    case 'opencypher':
      return `MATCH (n:${cypherIdent(label)}) RETURN n LIMIT 25`;
    case 'aql':
      return `FOR doc IN ${cypherIdent(label)} LIMIT 25 RETURN doc`;
    case 'ngql':
      return `MATCH (v:${cypherIdent(label)}) RETURN v LIMIT 25`;
    case 'gsql':
      return `SELECT * FROM ${cypherIdent(label)} LIMIT 25`;
    case 'sparql':
      return `SELECT * WHERE { ?s a ${sqlString(label)} . ?s ?p ?o } LIMIT 25`;
    case 'graphql':
      return `{ ${label} { __typename } }`;
    default:
      return null;
  }
}

/** A "show me 25 of these edges" query, or null if the dialect has none. */
export function edgeQueryFor(dialect: string, label: string): string | null {
  switch (dialect) {
    case 'gremlin':
      return `g.E().hasLabel(${gremlinString(label)}).limit(25)`;
    case 'cypher':
    case 'opencypher':
      return `MATCH ()-[r:${cypherIdent(label)}]->() RETURN r LIMIT 25`;
    case 'aql':
      return `FOR edge IN ${cypherIdent(label)} LIMIT 25 RETURN edge`;
    case 'ngql':
      return `MATCH ()-[e:${cypherIdent(label)}]->() RETURN e LIMIT 25`;
    case 'gsql':
      return `SELECT * FROM ${cypherIdent(label)} LIMIT 25`;
    case 'sparql':
      return `SELECT * WHERE { ?s ${sqlString(label)} ?o } LIMIT 25`;
    default:
      return null;
  }
}
