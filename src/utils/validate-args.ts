/**
 * Tool argument validation.
 */

export interface ToolDefinition {
  name: string;
  inputSchema?: {
    required?: string[];
    properties?: Record<string, any>;
  };
}

/**
 * Validate tool arguments against the tool's declared `inputSchema`.
 *
 * The low-level MCP `Server` does not validate arguments, and the dispatcher in
 * `src/index.ts` casts them straight through (`args as ...`), so a client that
 * omitted a required parameter reached the implementation and surfaced whatever
 * internal failure happened first — `docs_search` with no `query` answered "Cannot read
 * properties of undefined (reading 'length')". Schemas already declare
 * `required`, enums and types; this enforces what they promise.
 */
export function validateToolArguments(
  tools: readonly ToolDefinition[],
  name: string,
  args: unknown
): string | null {
  const schema = tools.find((tool) => tool.name === name)?.inputSchema;
  if (!schema) {
    return null;
  }

  const provided: Record<string, unknown> =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};

  const missing = (schema.required || []).filter((key) => {
    const value = provided[key];
    return value === undefined || value === null || value === '';
  });

  if (missing.length > 0) {
    return `Missing required parameter${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`;
  }

  for (const [key, value] of Object.entries(provided)) {
    const property = schema.properties?.[key];
    if (!property || value === undefined || value === null) {
      continue;
    }

    const expected = property.type as string | undefined;
    const actual = Array.isArray(value) ? 'array' : typeof value;
    const typeMatches =
      !expected || (expected === 'integer' ? Number.isInteger(value) : expected === actual);

    if (!typeMatches) {
      return `Parameter "${key}" must be of type ${expected}, received ${actual}`;
    }

    if (Array.isArray(property.enum) && !property.enum.includes(value as never)) {
      return `Invalid value for "${key}": ${JSON.stringify(value)}. Valid values: ${property.enum.join(', ')}`;
    }
  }

  return null;
}
