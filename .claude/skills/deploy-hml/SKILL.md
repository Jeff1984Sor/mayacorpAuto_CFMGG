---
name: deploy-hml
description: Publica a branch develop na homologação (hml-automacoes.mayacorp.com.br), roda testes e migrations e reinicia os serviços. Use para subir qualquer alteração para teste antes da produção.
---

# Subir para a homologação

Homologação roda com o modo **Teste** (Configurações › Prefeitura): tudo vai à Prefeitura pelo `TesteEnvioLoteRPS` e nenhuma nota real é gerada. O modo Produção nem aparece fora do servidor de produção.

## Antes

1. Estar na branch `develop`.
2. `cd backend && uv run python -m pytest -q` passando.
3. Se mexeu em model: `uv run python -m alembic revision --autogenerate -m "..."` e conferir o arquivo gerado.
4. `cd frontend && npm run build` sem erro.
5. Commit em português explicando **por que**, e `git push origin develop`.

## Publicar

```bash
ssh deploy@<servidor> 'cd ~/mayacorp-automacoes/hml && ./deploy/deploy.sh hml'
```

O script para sozinho se os testes falharem, antes de reiniciar qualquer serviço.

## Depois

- Abrir `https://hml-automacoes.mayacorp.com.br`, subir um arquivo real da Lello e acompanhar o lote até o fim.
- Conferir em Lotes › detalhe se o "Teste na Prefeitura" passou limpo.
- Contar ao Jefferson o que mudou e o endereço para conferir.
