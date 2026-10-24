---
name: deploy-prod
description: Promove para produção (mayajus.mayacorp.com.br) o que já foi validado em homologação, criando a tag vN. Use só quando o Jefferson mandar publicar em produção.
---

# Publicar em produção

**Só com ordem explícita do Jefferson**, e só o que já passou pela homologação. Produção emite nota real quando o modo **Produção** é ligado em Configurações › Prefeitura (pede a confirmação EMITIR NOTAS REAIS).

## Antes

1. A mesma versão está em homologação e foi validada, com o lote de teste limpo na Prefeitura.
2. Merge de `develop` em `main` e `git push origin main`.

## Publicar

```bash
ssh deploy@<servidor> 'cd ~/mayacorp-automacoes/prod && ./deploy/deploy.sh prod'
```

O script cria a próxima tag `vN`, grava em `backend/VERSION` (aparece no rodapé) e confere o `/api/health`.

## Se der errado

```bash
ssh deploy@<servidor> 'cd ~/mayacorp-automacoes/prod && ./deploy/rollback.sh prod v<anterior>'
```

Antes do rollback, verifique se há lote **transmitindo**. O worker termina o sublote em andamento (até 180 s) antes de parar.
