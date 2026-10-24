"use client";

import { createContext, useContext } from "react";

/** Id gerado pelo <Field>: o Input/Textarea dentro dele adota este id e o rótulo fica ligado ao campo. */
export const FieldIdContext = createContext<string | undefined>(undefined);

export function useFieldId() {
  return useContext(FieldIdContext);
}
