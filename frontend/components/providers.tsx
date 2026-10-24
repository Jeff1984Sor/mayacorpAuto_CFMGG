"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { toast, Toaster } from "sonner";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api";
import { AuthProvider } from "@/lib/auth";
import { BrandProvider } from "@/lib/brand";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 20_000,
            refetchOnWindowFocus: false,
            retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
          },
        },
        queryCache: new QueryCache({
          onError: (e, q) => {
            if (q.meta?.silencioso) return;
            if (e instanceof ApiError && e.status === 401) return;
            toast.error(e.message);
          },
        }),
        mutationCache: new MutationCache({
          onError: (e, _v, _c, m) => {
            if (m.meta?.silencioso) return;
            toast.error(e.message);
          },
        }),
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <BrandProvider>
          <AuthProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </AuthProvider>
        </BrandProvider>
        <Toaster richColors closeButton position="top-right" toastOptions={{ classNames: { toast: "rounded-xl!" } }} />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
