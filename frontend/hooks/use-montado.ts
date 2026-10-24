import { useSyncExternalStore } from "react";

const nada = () => () => {};

/** true somente no cliente, após a hidratação. */
export function useMontado() {
  return useSyncExternalStore(
    nada,
    () => true,
    () => false,
  );
}
