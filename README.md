# hindclaw-kb

Product-wide code-first knowledge base for [Hindclaw](https://hindclaw.pro). Indexes source code across the core repo and all component repos into a SQLite vector database with hybrid search.

## Install

```bash
npm install -g hindclaw-kb
```

## Usage

```bash
# Index the Hindclaw source tree
hindclaw-kb index

# Search all code
hindclaw-kb query "access control validator"

# Filter by component
hindclaw-kb extension "tenant extension"
hindclaw-kb terraform "provider resource"
hindclaw-kb integrations "recall hook"

# Code + related tests (two-pass)
hindclaw-kb verify "policy evaluation"

# Metadata
hindclaw-kb stats
hindclaw-kb latest
hindclaw-kb history
hindclaw-kb since hindclaw ext-v0.1.0
```

## MCP Server

```bash
hindclaw-kb mcp-serve
```

10 tools: `search`, `search_code`, `search_extension`, `search_integrations`, `search_terraform`, `search_tests`, `get_stats`, `get_latest`, `get_history`, `get_since`.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `HINDCLAW_ROOT_DIR` | `./source` | Hindclaw working tree |
| `KB_DATA_DIR` | `./data` | SQLite database |
| `OPENAI_API_KEY` | required | Embedding generation |
| `KB_EMBEDDING_PROVIDER` | `openai` | `local` for ONNX |

## License

MIT
