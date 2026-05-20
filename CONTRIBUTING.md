# Contributing

Contributions are welcome — patterns, probes, docs improvements, and new docs.

## What belongs here

- **Patterns** that apply to any MCP server or LLM-as-client system, not project-specific code
- **Probes** that test a failure mode you encountered in production and want to prevent broadly
- **Docs** that improve clarity or fill a gap in the existing guides

## How to contribute

1. Fork and create a branch
2. Add or edit content
3. Open a PR with a short description of what problem it solves and where you encountered it

## Docs style

- Use concrete examples over abstract descriptions
- Show the failure mode first, then the fix
- Keep TypeScript examples generic — no project-specific imports

## Code style (qa-framework)

- TypeScript strict mode
- No external runtime dependencies beyond what's in `package.json`
- Every new export gets a corresponding type in `types.ts`
