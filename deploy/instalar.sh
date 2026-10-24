#!/usr/bin/env bash
#
# Primeira instalação de um ambiente no servidor (Ubuntu/Debian, Google Cloud).
# Depois disso, as atualizações são só:  ./deploy/deploy.sh hml   (ou prod)
#
# Uso (no servidor, com sudo):
#   curl -fsSL https://raw.githubusercontent.com/Jeff1984Sor/mayacorpAuto_CFMGG/main/deploy/instalar.sh -o instalar.sh
#   sudo bash instalar.sh hml        # homologação  → hml-automacoes.mayacorp.com.br
#   sudo bash instalar.sh prod       # produção     → automacoes.mayacorp.com.br
#
# O banco começa VAZIO (só o cliente CFME, a identidade e as configurações). No fim, o script pede
# o login e a senha do primeiro administrador; a senha não fica gravada em arquivo nenhum.
#
set -euo pipefail

AMB="${1:?informe o ambiente: hml ou prod}"
case "$AMB" in
  hml)  BRANCH=develop; API_PORTA=8100; WEB_PORTA=3100; DOMINIO=hml-automacoes.mayacorp.com.br ;;
  prod) BRANCH=main;    API_PORTA=8000; WEB_PORTA=3000; DOMINIO=automacoes.mayacorp.com.br ;;
  *) echo "Ambiente inválido: $AMB (use hml ou prod)"; exit 1 ;;
esac
REPO="${REPO:-https://github.com/Jeff1984Sor/mayacorpAuto_CFMGG.git}"
BASE=/opt/mayacorp-automacoes
DIR="$BASE/$AMB"
BANCO="automacoes_$AMB"
USUARIO_SO=mayacorp

[ "$(id -u)" = "0" ] || { echo "Rode com sudo."; exit 1; }
echo "=== Instalando MayaCorp Automações ($AMB) em $DIR ==="

echo "--- 1/8 Pacotes do sistema"
apt-get update -qq
apt-get install -y -qq git curl openssl python3 nginx postgresql-client libpq5 >/dev/null
# Servidor sem PostgreSQL (VPS nova): instala o servidor local também
if ! id postgres >/dev/null 2>&1; then
  echo "    PostgreSQL não encontrado: instalando"
  apt-get install -y -qq postgresql >/dev/null
fi
systemctl enable --now postgresql >/dev/null 2>&1 || true
command -v certbot >/dev/null || apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
id "$USUARIO_SO" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$USUARIO_SO"
if ! sudo -u "$USUARIO_SO" bash -lc 'command -v uv' >/dev/null; then
  sudo -u "$USUARIO_SO" bash -lc 'curl -LsSf https://astral.sh/uv/install.sh | sh' >/dev/null
fi
UV="/home/$USUARIO_SO/.local/bin/uv"

echo "--- 2/8 Código ($BRANCH)"
mkdir -p "$BASE"
chown "$USUARIO_SO": "$BASE"
if [ ! -d "$DIR/.git" ]; then
  sudo -u "$USUARIO_SO" git clone -q -b "$BRANCH" "$REPO" "$DIR"
else
  echo "    (já existe: use ./deploy/deploy.sh $AMB para atualizar)"; exit 1
fi

echo "--- 3/8 Banco de dados $BANCO (PostgreSQL já existente no servidor)"
SENHA_BANCO="$(openssl rand -hex 24)"
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='mayacorp_$AMB'" | grep -q 1; then
  sudo -u postgres psql -q -c "ALTER ROLE mayacorp_$AMB WITH LOGIN PASSWORD '$SENHA_BANCO'"
else
  sudo -u postgres psql -q -c "CREATE ROLE mayacorp_$AMB WITH LOGIN PASSWORD '$SENHA_BANCO'"
fi
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$BANCO'" | grep -q 1; then
  echo "    ATENÇÃO: o banco $BANCO já existe e NÃO foi apagado. Para começar vazio, apague-o antes."
else
  sudo -u postgres psql -q -c "CREATE DATABASE $BANCO OWNER mayacorp_$AMB ENCODING 'UTF8'"
fi

echo "--- 4/8 Configuração do servidor (.env só com o que é de servidor; o resto fica em Configurações)"
MASTER_KEY="$(python3 -c 'import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())')"
cat > "$DIR/backend/.env" <<ENV
AMBIENTE=$AMB
API_PORTA=$API_PORTA
DATABASE_URL=postgresql+psycopg://mayacorp_$AMB:$SENHA_BANCO@127.0.0.1:5432/$BANCO
FRONTEND_URL=https://$DOMINIO
CORS_ORIGINS=["https://$DOMINIO"]
JWT_SECRET=$(openssl rand -hex 48)
MASTER_KEY=$MASTER_KEY
WORKER_EMBUTIDO=false
MIGRAR_NA_SUBIDA=false
ENV
chmod 600 "$DIR/backend/.env"
cat > "$DIR/frontend/.env.production" <<ENV
NEXT_PUBLIC_API_URL=https://$DOMINIO/api
NEXT_PUBLIC_AMBIENTE=$AMB
NEXT_PUBLIC_VERSAO=$AMB
WEB_PORTA=$WEB_PORTA
ENV
chown "$USUARIO_SO": "$DIR/backend/.env" "$DIR/frontend/.env.production"
echo "    Guarde em local seguro a MASTER_KEY (está em $DIR/backend/.env): sem ela o certificado precisa ser reenviado."

echo "--- 5/8 Backend: dependências, migrations e base vazia"
sudo -u "$USUARIO_SO" bash -lc "cd $DIR/backend && $UV sync --frozen -q && $UV run python -m alembic upgrade head && $UV run python -m app.seed --somente-base"

echo "--- 6/8 Frontend: build"
sudo -u "$USUARIO_SO" bash -lc "cd $DIR/frontend && npm ci --silent && npm run build >/dev/null"

echo "--- 7/8 Serviços (systemd) e nginx"
cp "$DIR"/deploy/systemd/mayacorp-*@.service /etc/systemd/system/
sed -i "s|/home/mayacorp/.local/bin/uv|$UV|g" /etc/systemd/system/mayacorp-*@.service
systemctl daemon-reload
systemctl enable --now "mayacorp-api@$AMB" "mayacorp-worker@$AMB" "mayacorp-web@$AMB"
cp "$DIR/deploy/nginx/automacoes.conf" /etc/nginx/sites-available/automacoes
ln -sf /etc/nginx/sites-available/automacoes /etc/nginx/sites-enabled/automacoes
nginx -t -q && systemctl reload nginx
# backup diário às 02:00 (só produção)
if [ "$AMB" = "prod" ]; then
  echo "0 2 * * * $USUARIO_SO $DIR/deploy/backup.sh prod >> /var/log/mayacorp-backup.log 2>&1" > /etc/cron.d/mayacorp-backup
fi
echo "    SSL: certbot --nginx -d $DOMINIO   (rode depois que o DNS apontar para este servidor)"

echo "--- 8/8 Primeiro administrador"
read -r -p "    Login: " LOGIN
read -r -p "    Nome: " NOME
read -r -p "    E-mail: " EMAIL
sudo -u "$USUARIO_SO" bash -lc "cd $DIR/backend && $UV run python -m app.criar_usuario --login '$LOGIN' --nome '$NOME' --email '$EMAIL' --perfil admin" </dev/tty

sleep 3
CODIGO="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$API_PORTA/api/health" || echo 000)"
echo
echo "=== Pronto: $AMB instalado (API: HTTP $CODIGO) ==="
echo "    Acesse https://$DOMINIO e entre com o login '$LOGIN'."
echo "    Próximos passos em Configurações: Identidade (logo), Certificado digital, Empresa emissora,"
echo "    Parâmetros fiscais (com o contador), Usuários da CFME e Prefeitura (modo Teste em hml)."
