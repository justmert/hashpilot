# HashPilot RAG System - Production Deployment

Deploy the HashPilot RAG (Retrieval-Augmented Generation) system on AWS EC2 (ARM64).

## Architecture

```
                    Traefik (proxy network)
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
    [chromadb:8000] [rag-indexer]  [firecrawl:3002]
           │               │               │
           └───────────────┼───────────────┘
                           │ (rag-network)
                ┌──────────┼──────────┐
                │          │          │
                ▼          ▼          ▼
            [redis]  [playwright] [worker]
```

## Services

| Service | Purpose | Port |
|---------|---------|------|
| chromadb | Vector database for embeddings | 8000 |
| rag-indexer | Node.js indexing service | - |
| firecrawl-api | Web crawling API | 3002 |
| firecrawl-worker | Background job processor | - |
| redis | Job queue for Firecrawl | 6379 |
| playwright | Browser rendering | 3000 |

## Prerequisites

- AWS EC2 instance (ARM64/Graviton recommended)
- Docker & docker-compose installed
- Traefik proxy configured with `proxy` network
- Domain pointing to your server (e.g., chroma.hash-pilot.app)

## Quick Start

### 1. Clone Repository

```bash
git clone https://github.com/anthropics/hashpilot-mcp
cd hashpilot-mcp/docker/deploy
```

### 2. Configure Environment

```bash
cp .env.example .env
nano .env
```

Required variables:
- `OPENAI_API_KEY` - Your OpenAI API key
- `GITHUB_TOKEN` - GitHub personal access token
- `DOMAIN` - Your domain (default: chroma.hash-pilot.app)

### 3. Deploy

```bash
./deploy.sh deploy
```

### 4. Run Indexing

```bash
# Full indexing (docs, HIPs, SDKs) - takes 30-60 min
./deploy.sh index-all

# Or index individually:
./deploy.sh index-docs   # Hedera documentation
./deploy.sh index-hips   # Hedera Improvement Proposals
./deploy.sh index-sdk    # SDK repositories
```

## Commands Reference

### Deployment

```bash
./deploy.sh deploy      # Build and start all services
./deploy.sh stop        # Stop all services
./deploy.sh restart     # Restart all services
./deploy.sh rebuild     # Rebuild from scratch (no cache)
./deploy.sh status      # Show health status
./deploy.sh logs        # View all logs
./deploy.sh logs chromadb  # View specific service logs
```

### Indexing

```bash
./deploy.sh index-all   # Full indexing
./deploy.sh index-docs  # Documentation only
./deploy.sh index-hips  # HIPs only
./deploy.sh index-sdk   # SDK repos only
```

### Maintenance

```bash
./deploy.sh shell       # Shell into rag-indexer
./deploy.sh shell chromadb  # Shell into chromadb
./deploy.sh backup      # Backup ChromaDB data
./deploy.sh clean       # Remove everything (DESTRUCTIVE)
```

## Data Sources

The RAG system indexes the following sources:

### 1. Hedera Documentation
- Source: docs.hedera.com
- Method: Firecrawl web crawling
- Updates: Manual re-index

### 2. Hedera Improvement Proposals (HIPs)
- Source: github.com/hashgraph/hedera-improvement-proposal
- Method: GitHub API
- Updates: Manual re-index

### 3. SDK Repositories
- Hedera SDK JS
- Hedera SDK Java
- Hedera SDK Go
- Hedera SDK Python
- Hedera SDK Rust
- Method: Git clone + parse
- Updates: Manual re-index

## ChromaDB Collections

| Collection | Content |
|------------|---------|
| hedera-docs-all | Unified collection (default) |
| hedera-docs-tutorials | Step-by-step guides |
| hedera-docs-api | API reference |
| hedera-docs-concepts | Conceptual docs |
| hedera-docs-examples | Code examples |

## API Access

Once deployed, ChromaDB is accessible at:
- External: `https://chroma.hash-pilot.app`
- Internal: `http://chromadb:8000`

Authentication header required:
```bash
curl -H "Authorization: Bearer YOUR_CHROMA_AUTH_TOKEN" \
  https://chroma.hash-pilot.app/api/v1/heartbeat
```

## Troubleshooting

### Services not starting

```bash
# Check logs
./deploy.sh logs

# Check individual service
./deploy.sh logs chromadb
./deploy.sh logs firecrawl-api
```

### ChromaDB unhealthy

```bash
# Check ChromaDB logs
docker-compose logs chromadb

# Restart ChromaDB
docker-compose restart chromadb
```

### Indexing fails

```bash
# Check indexer logs
./deploy.sh logs rag-indexer

# Shell into indexer for debugging
./deploy.sh shell rag-indexer
```

### Network issues

```bash
# Ensure proxy network exists
docker network ls | grep proxy

# Create if missing
docker network create proxy
```

## Resource Requirements

Minimum recommended for AWS EC2:
- Instance: t4g.medium (ARM64)
- RAM: 4GB
- Storage: 20GB SSD
- Network: Public IP with domain

For production with full indexing:
- Instance: t4g.large or better
- RAM: 8GB
- Storage: 50GB SSD

## Backup & Restore

### Create Backup

```bash
./deploy.sh backup
# Creates: ./backups/YYYYMMDD_HHMMSS/chroma-data.tar.gz
```

### Restore from Backup

```bash
# Stop services
./deploy.sh stop

# Restore data
docker run --rm \
  -v hashpilot-chroma-data:/data \
  -v $(pwd)/backups/BACKUP_DIR:/backup \
  alpine tar xzf /backup/chroma-data.tar.gz -C /data

# Start services
./deploy.sh deploy
```

## Security Notes

- ChromaDB requires authentication token
- Firecrawl is not exposed externally
- Redis is internal only
- Use HTTPS via Traefik
- Rotate tokens periodically
- Keep GitHub token with minimal permissions

## License

MIT License - See main repository for details.
