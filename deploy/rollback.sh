#!/usr/bin/env bash
# Volta um ambiente para uma versão anterior:  ./deploy/rollback.sh prod v7
# Não desfaz migrations: se a versão nova criou colunas, elas ficam (o código antigo as ignora).
set -euo pipefail
AMB="${1:?ambiente (hml|prod)}"
VERSAO="${2:?versão (ex.: v7)}"
APP_DIR="${APP_DIR:-$HOME/mayacorp-automacoes/$AMB}"
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
cd "$APP_DIR"
if ! git rev-parse -q --verify "refs/tags/$VERSAO" >/dev/null; then
  echo "Tag $VERSAO não existe. Últimas:"
  git tag --list 'v*' | sort -V | tail -5
  exit 1
fi
git checkout -q "$VERSAO"
(cd backend && "$UV" sync --frozen -q)
(cd frontend && npm ci --silent && npm run build >/dev/null)
echo "$VERSAO" > backend/VERSION
sudo systemctl restart "automacoes-api@$AMB" "automacoes-worker@$AMB" "automacoes-web@$AMB"
echo "Ambiente $AMB de volta em $VERSAO. Para retomar a branch: git checkout main"
