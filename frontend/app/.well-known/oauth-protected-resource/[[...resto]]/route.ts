import { CABECALHOS, recursoProtegido } from "@/lib/mcp-descoberta";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return Response.json(recursoProtegido(req), { headers: CABECALHOS });
}
