# HashPilot RAG backend on Railway

Two services in one Railway project:

| Service | Source | Exposure | Purpose |
|---|---|---|---|
| `chromadb` | image `chromadb/chroma:1.5.9`, volume at `/data` | private only (`chromadb.railway.internal:8000`) | vector store |
| `chroma-gateway` | `docker/railway/gateway` (Caddy) | public domain | token check in front of Chroma |

Chroma 1.x has no built-in authentication, so the gateway enforces two tokens
(`CHROMA_ADMIN_TOKEN` for indexing, `CHROMA_READ_TOKEN` for the MCP server's
query path). The read token only allows `GET` and `POST` to `query`, `get` and
`count`; everything else returns 403. Heartbeat and version are public.

## Deploy

```bash
railway login
railway up docker/railway/gateway --path-as-root -p <project-id> -e production -s chroma-gateway -d
```

Variables on `chroma-gateway`: `PORT=8080`, `CHROMA_UPSTREAM=http://chromadb.railway.internal:8000`,
`CHROMA_ADMIN_TOKEN`, `CHROMA_READ_TOKEN`.
Variables on `chromadb`: `IS_PERSISTENT=TRUE`, `PERSIST_DIRECTORY=/data`, `ANONYMIZED_TELEMETRY=FALSE`.

## Index

```bash
export CHROMA_URL=https://<gateway-domain> CHROMA_AUTH_TOKEN=<admin token> OPENAI_API_KEY=sk-...
npm run index-docs-repo      # docs.hedera.com from the hashgraph/hedera-docs repo
npm run index-hips
npm run index-sdk
npm run index-tutorials
npm run index-network
```

The MCP server ships the gateway URL and the read token as defaults; users only
need `OPENAI_API_KEY`. Override with `CHROMA_URL` / `CHROMA_AUTH_TOKEN` to self-host.
