function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function ponderSearchPath(schema: string): string {
  return schema === "public" ? quoteIdent("public") : `${quoteIdent(schema)}, public`;
}
