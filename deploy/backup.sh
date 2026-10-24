#!/usr/bin/env bash
# Backup diário (cron 02:00):  0 2 * * * /opt/mayacorp-automacoes/prod/deploy/backup.sh prod
# Banco (pg_dump) + PDFs/XMLs. Envia para fora do servidor (bucket GCS) e mantém 30 dias local.
# XMLs fiscais: configure no bucket uma regra de retenção que cubra o prazo legal de guarda.
set -euo pipefail
AMB="${1:-prod}"
APP_DIR="/opt/mayacorp-automacoes/$AMB"
DESTINO="${BACKUP_DIR:-/var/backups/mayacorp-automacoes/$AMB}"
BUCKET="${BACKUP_BUCKET:-gs://mayacorp-backups/automacoes/$AMB}"
set -a; . "$APP_DIR/backend/.env"; set +a
mkdir -p "$DESTINO"
DIA="$(date +%Y%m%d)"
pg_dump "${DATABASE_URL/+psycopg/}" -Fc -f "$DESTINO/banco_$DIA.dump"
tar -czf "$DESTINO/arquivos_$DIA.tar.gz" -C "$APP_DIR/backend" storage
if command -v gcloud >/dev/null; then
  gcloud storage cp -q "$DESTINO/banco_$DIA.dump" "$DESTINO/arquivos_$DIA.tar.gz" "$BUCKET/$DIA/"
fi
find "$DESTINO" -type f -mtime +30 -delete
echo "Backup $AMB $DIA ok"
