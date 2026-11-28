import { CABECALHOS, servidorDeAutorizacao } from "@/lib/mcp-descoberta";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return Response.json(servidorDeAutorizacao(req), { headers: CABECALHOS });
}
