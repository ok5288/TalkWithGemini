# Tool Schema compatibility audit

Reviewed on 2026-09-11 after a `start_long_text_output` call with valid `title`
and `format` arguments returned `TOOL_SCHEMA_INVALID`.

## Fixed

The [shared validator](../src/lib/agent/toolSchema.ts) used Ajv runtime code
generation. Hosted CSP blocks `new Function`, so valid schemas failed before
the tool executed. The same validator is used for other built-in tools, plugin
arguments, structured output, and the plugin execution route's server checks.
It now interprets schemas without dynamic JavaScript compilation and preserves
the existing validation rules. The application's direct Ajv dependency and
imports have been removed; SDK and development-tool transitive dependencies
still exist.

The [MCP client](../src/lib/mcp/client.ts) had a separate instance of this
problem: the SDK's default validator compiled discovered `outputSchema`
definitions. It now uses the SDK's Worker-compatible validator. The independent
Node stdio bridge does not run under browser CSP or Cloudflare restrictions.

Neither fix relaxes the hosted CSP. See the
[Ajv CSP documentation](https://github.com/ajv-validator/ajv/blob/master/docs/security.md)
and the [interpreter documentation](https://github.com/cfworker/cfworker/tree/master/packages/json-schema).

## Additional findings and follow-up status

### Explicit MCP schema dialects

The public tool validator retains its existing Draft 7 dialect. An MCP tool
declaring `$schema: "https://json-schema.org/draft/2020-12/schema"` can now pass
discovery but is still rejected with `TOOL_SCHEMA_INVALID` before execution.
Undeclared schemas using newer keywords also need explicit dialect handling.
The [MCP specification](https://modelcontextprotocol.io/specification/2025-11-25/schema)
uses 2020-12 by default.

A follow-up should carry the MCP dialect consistently through discovery,
browser validation, and server revalidation, with dialect-specific meta-schema
tests. Changing the default for every existing plugin would alter unrelated
validation behavior.

### Gemini schema conversion

Fixed on 2026-10-09. The shared chat dispatcher selects the parameter format
using the same resolved API version as the Google SDK client. Default and
explicit `v1beta` endpoints receive the original `parametersJsonSchema`,
including unions, references, and constraints. Other explicitly selected versions
receive converted `parameters`; the fields are mutually exclusive and tools
without a parameter schema omit both. No version rewrite or retry downgrade is
performed.

[The compatibility converter](../src/lib/utils/schema.ts) supports nullable and
multi-type unions, `anyOf`, nested properties/items, and the installed SDK's
supported scalar constraints. Integer-size constraints are represented as the
SDK's decimal strings. Local JSON Pointer references are expanded without
network access. Missing, external, cyclic, or conflicting reference siblings
raise a compatibility error naming the tool and schema path. Unsupported legacy
keywords (including `additionalProperties` and non-string enums) produce only a
development log containing the keyword and path, never schema values. The
executor continues validating against the unchanged original schema.

Tests cover nullable unions, reference failures and escaped pointers, input
immutability, version selection, absent parameter schemas, and request bodies
serialized by the real Google SDK against a mocked HTTP transport. These checks
do not establish acceptance by a live Google endpoint. The old duplicate
converter in `apiHelpers.ts` was unused and has been removed.

### JavaScript sandbox CSP: browser verification still needed

[The sandbox](../src/utils/sandbox.ts) runs `new Function` inside a Blob Worker,
while its iframe CSP omits `unsafe-eval`. This is a likely independent CSP
conflict. Existing sandbox tests simulate messages and inspect generated HTML;
they do not establish actual browser CSP behavior or inherited policies.

Verify a real sandbox run under hosted headers before changing this boundary.
Any fix must preserve the opaque origin, blocked network/storage access,
termination, and output limits, without relaxing the application's top-level
CSP.

## Validation

- The screenshot's registered tool schema reproduced the original error with
  `Function` blocked, then passed after the fix.
- Tests cover invalid arguments and outputs, no input mutation or coercion,
  schema references, nullable values, and schemas from the built-in registry.
- A real MCP SDK Client/Streamable HTTP Transport with mocked responses passes
  discovery with code generation disabled and rejects invalid structured output.
- Full Vitest suite: 392 files, 2,692 tests passed. Lint, TypeScript, dependency
  audit, production build, and OpenNext Worker build passed.
- No E2E or production deployment was run for this patch. The sandbox finding
  is static evidence, not a verified browser failure.
