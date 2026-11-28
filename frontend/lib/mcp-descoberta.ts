/**
 * Descoberta OAuth do conector MCP na raiz do domínio (/.well-known/...). O Claude procura ali; o nginx só manda
 * /api para o backend, então quem responde é o Next. Os mesmos dados saem de backend/app/modules/mcp/oauth.py.
 */
export function enderecoPublico(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? new URL(req.url).host;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

const ESCOPOS = ["leitura", "escrita"];

export function recursoProtegido(req: Request) {
  const b = enderecoPublico(req);
  return {
    resource: `${b}/api/mcp`,
    authorization_servers: [b],
    bearer_methods_supported: ["header"],
    scopes_supported: ESCOPOS,
    resource_name: "MayaJus",
  };
}

export function servidorDeAutorizacao(req: Request) {
  const b = enderecoPublico(req);
  return {
    issuer: b,
    authorization_endpoint: `${b}/api/mcp/oauth/autorizar`,
    token_endpoint: `${b}/api/mcp/oauth/token`,
    registration_endpoint: `${b}/api/mcp/oauth/registrar`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ESCOPOS,
  };
}

export const CABECALHOS = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" };
