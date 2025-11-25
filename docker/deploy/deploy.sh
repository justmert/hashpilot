#!/bin/bash

# ============================================
# HashPilot RAG System - Deployment Script
# AWS EC2 ARM64 Compatible
# ============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ============================================
# Helper Functions
# ============================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_requirements() {
    log_info "Checking requirements..."

    # Check docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi

    # Check docker-compose
    if ! command -v docker-compose &> /dev/null; then
        log_error "docker-compose is not installed"
        exit 1
    fi

    # Check .env file
    if [ ! -f ".env" ]; then
        log_error ".env file not found!"
        log_info "Copy .env.example to .env and configure it:"
        echo "  cp .env.example .env"
        echo "  nano .env"
        exit 1
    fi

    # Validate required env vars
    source .env

    if [ -z "$OPENAI_API_KEY" ]; then
        log_error "OPENAI_API_KEY is not set in .env"
        exit 1
    fi

    if [ -z "$CHROMA_AUTH_TOKEN" ]; then
        log_warn "CHROMA_AUTH_TOKEN is not set - generating random token..."
        CHROMA_AUTH_TOKEN=$(openssl rand -hex 32)
        echo "CHROMA_AUTH_TOKEN=$CHROMA_AUTH_TOKEN" >> .env
        log_info "Generated token: $CHROMA_AUTH_TOKEN"
    fi

    log_success "All requirements met"
}

ensure_network() {
    log_info "Ensuring proxy network exists..."
    if ! docker network ls | grep -q "proxy"; then
        log_info "Creating proxy network..."
        docker network create proxy
    fi
    log_success "Proxy network ready"
}

# ============================================
# Commands
# ============================================

cmd_deploy() {
    log_info "Deploying HashPilot RAG System..."

    check_requirements
    ensure_network

    log_info "Building and starting services..."
    docker-compose build
    docker-compose up -d

    log_info "Waiting for services to be healthy..."
    sleep 10

    cmd_status

    log_success "Deployment complete!"
    echo ""
    log_info "Next steps:"
    echo "  1. Check logs: ./deploy.sh logs"
    echo "  2. Run indexing: ./deploy.sh index-all"
    echo "  3. Check status: ./deploy.sh status"
}

cmd_stop() {
    log_info "Stopping HashPilot RAG System..."
    docker-compose down
    log_success "All services stopped"
}

cmd_restart() {
    log_info "Restarting HashPilot RAG System..."
    docker-compose restart
    log_success "All services restarted"
}

cmd_rebuild() {
    log_info "Rebuilding HashPilot RAG System..."
    check_requirements
    ensure_network
    docker-compose down
    docker-compose build --no-cache
    docker-compose up -d
    log_success "Rebuild complete"
}

cmd_logs() {
    SERVICE=${1:-""}
    if [ -n "$SERVICE" ]; then
        docker-compose logs -f --tail=100 "$SERVICE"
    else
        docker-compose logs -f --tail=100
    fi
}

cmd_status() {
    log_info "Service Status:"
    echo ""
    docker-compose ps
    echo ""

    log_info "Health Checks:"

    # ChromaDB health
    if docker-compose exec -T chromadb curl -sf http://localhost:8000/api/v2/heartbeat > /dev/null 2>&1; then
        echo -e "  ChromaDB:    ${GREEN}healthy${NC}"
    else
        echo -e "  ChromaDB:    ${RED}unhealthy${NC}"
    fi

    # External Firecrawl health (runs separately)
    FIRECRAWL_URL="${FIRECRAWL_URL:-http://172.17.0.1:3002}"
    if curl -sf "${FIRECRAWL_URL}/health" > /dev/null 2>&1; then
        echo -e "  Firecrawl:   ${GREEN}healthy${NC} (external: ${FIRECRAWL_URL})"
    else
        echo -e "  Firecrawl:   ${YELLOW}not running${NC} (external: ${FIRECRAWL_URL})"
        echo -e "               ${BLUE}Run Firecrawl separately: cd ~/firecrawl && docker compose up -d${NC}"
    fi

    echo ""
}

cmd_index_all() {
    log_info "Running full indexing (docs, HIPs, SDKs)..."
    log_warn "This may take 30-60 minutes depending on network speed"

    # Run indexing scripts sequentially
    cmd_index_docs
    cmd_index_hips
    cmd_index_sdk

    log_success "Full indexing complete!"
}

cmd_index_docs() {
    log_info "Indexing Hedera documentation via Firecrawl..."
    docker-compose exec -T rag-indexer npm run index-docs 2>&1
    log_success "Documentation indexing complete"
}

cmd_index_hips() {
    log_info "Indexing Hedera Improvement Proposals from GitHub..."
    docker-compose exec -T rag-indexer npm run index-hips 2>&1
    log_success "HIPs indexing complete"
}

cmd_index_sdk() {
    log_info "Indexing Hedera SDK repositories from GitHub..."
    docker-compose exec -T rag-indexer npm run index-sdk 2>&1
    log_success "SDK indexing complete"
}

cmd_shell() {
    SERVICE=${1:-"rag-indexer"}
    log_info "Opening shell in $SERVICE..."
    docker-compose exec "$SERVICE" /bin/bash || docker-compose exec "$SERVICE" /bin/sh
}

cmd_clean() {
    log_warn "This will remove all containers, volumes, and data!"
    read -p "Are you sure? (y/N): " confirm
    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
        docker-compose down -v
        log_success "Cleaned up all resources"
    else
        log_info "Cancelled"
    fi
}

cmd_backup() {
    BACKUP_DIR="./backups/$(date +%Y%m%d_%H%M%S)"
    log_info "Creating backup in $BACKUP_DIR..."
    mkdir -p "$BACKUP_DIR"

    # Backup ChromaDB data
    docker run --rm \
        -v hashpilot-chroma-data:/data \
        -v "$(pwd)/$BACKUP_DIR":/backup \
        alpine tar czf /backup/chroma-data.tar.gz -C /data .

    log_success "Backup created: $BACKUP_DIR/chroma-data.tar.gz"
}

cmd_help() {
    echo ""
    echo "HashPilot RAG System - Deployment Script"
    echo "========================================="
    echo ""
    echo "Usage: ./deploy.sh <command> [options]"
    echo ""
    echo "Deployment Commands:"
    echo "  deploy      Build and start all services"
    echo "  stop        Stop all services"
    echo "  restart     Restart all services"
    echo "  rebuild     Rebuild and restart (no cache)"
    echo "  status      Show service status and health"
    echo "  logs [svc]  Show logs (optionally for specific service)"
    echo ""
    echo "Indexing Commands:"
    echo "  index-all   Run full indexing (docs, HIPs, SDKs)"
    echo "  index-docs  Index Hedera documentation only"
    echo "  index-hips  Index HIPs only"
    echo "  index-sdk   Index SDK repositories only"
    echo ""
    echo "Maintenance Commands:"
    echo "  shell [svc] Open shell in container (default: rag-indexer)"
    echo "  backup      Backup ChromaDB data"
    echo "  clean       Remove all containers and volumes (DESTRUCTIVE)"
    echo "  help        Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./deploy.sh deploy      # First time deployment"
    echo "  ./deploy.sh index-all   # Run full indexing"
    echo "  ./deploy.sh logs        # Watch all logs"
    echo "  ./deploy.sh logs chromadb  # Watch ChromaDB logs only"
    echo ""
}

# ============================================
# Main
# ============================================

COMMAND=${1:-"help"}

case "$COMMAND" in
    deploy)
        cmd_deploy
        ;;
    stop)
        cmd_stop
        ;;
    restart)
        cmd_restart
        ;;
    rebuild)
        cmd_rebuild
        ;;
    logs)
        cmd_logs "$2"
        ;;
    status)
        cmd_status
        ;;
    index-all)
        cmd_index_all
        ;;
    index-docs)
        cmd_index_docs
        ;;
    index-hips)
        cmd_index_hips
        ;;
    index-sdk)
        cmd_index_sdk
        ;;
    shell)
        cmd_shell "$2"
        ;;
    backup)
        cmd_backup
        ;;
    clean)
        cmd_clean
        ;;
    help|--help|-h)
        cmd_help
        ;;
    *)
        log_error "Unknown command: $COMMAND"
        cmd_help
        exit 1
        ;;
esac
