# hindclaw-kb

Product-wide code-first knowledge base for the Hindclaw project.

## What This Is

`hindclaw-kb` indexes Hindclaw source code across the core repo and all component repos
(integrations, Terraform provider) into a SQLite vector database for hybrid search.

## Key Concepts

- **Component-aware:** Each source maps to a component (core, openclaw-plugin, claude-plugin, terraform-provider). Each component tracks its own version independently.
- **Code-first:** No docs indexed by default — only real implementation code.
- **Phase gating:** Phase 1 sources always indexed. Phase 2 (tests) opt-in via `KB_EXTRA_SOURCES`.

## Commands

```bash
hindclaw-kb query <text>       # hybrid search (vector + keyword)
hindclaw-kb code <text>        # all code sources
hindclaw-kb extension <text>   # extension code only
hindclaw-kb integrations <text> # integrations only
hindclaw-kb terraform <text>   # terraform/provider only
hindclaw-kb verify <text>      # code + related tests
hindclaw-kb index [--force]    # index/reindex all sources
hindclaw-kb stats              # DB statistics
hindclaw-kb latest             # latest version per component
hindclaw-kb history            # last 10 index runs
hindclaw-kb since <comp> <ver> # changes since a component version
hindclaw-kb mcp-serve          # start MCP server
```

## Environment Variables

| Variable | Default | Notes |
|----------|---------|-------|
| `HINDCLAW_ROOT_DIR` | `./source` | Hindclaw working tree |
| `KB_DATA_DIR` | `./data` | SQLite DB |
| `OPENAI_API_KEY` | required | for embeddings |
| `KB_EMBEDDING_PROVIDER` | `openai` | or `local` |
| `KB_EXTRA_SOURCES` | empty | e.g. `extension-tests,integration-tests` |

## Running Tests

```bash
node --test tests/
```
