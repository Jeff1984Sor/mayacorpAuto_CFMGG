import { Compass } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6">
      <div className="text-center">
        <div className="mx-auto mb-6 grid size-16 place-items-center rounded-2xl brand-gradient text-white shadow-xl shadow-brand/30">
          <Compass className="size-8" />
        </div>
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Página não encontrada</h1>
        <p className="mt-2 text-sm text-muted-foreground">O endereço pode ter mudado ou o item não existe mais.</p>
        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
