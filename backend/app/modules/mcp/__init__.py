"""Conector MCP: o Claude (claude.ai, Claude Code, Desktop) consulta e opera o MayaJus em nome de um usuário.

- `oauth.py`: login OAuth 2.1 (registro dinâmico de cliente, PKCE) e as conexões de cada usuário (ver e revogar);
- `servidor.py`: o endpoint MCP (`POST /api/mcp`, Streamable HTTP sem sessão, JSON-RPC);
- `ferramentas.py`: as ferramentas. Elas chamam a própria API por dentro, com o usuário da conexão: valem as
  mesmas permissões, validações e auditoria das telas. Rota nova na API aparece sozinha (vem do OpenAPI).
"""
