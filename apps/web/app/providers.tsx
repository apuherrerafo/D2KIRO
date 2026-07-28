"use client";

import { useState, type ReactNode } from "react";
import { Provider } from "react-redux";
import { makeStore } from "@/lib/store";

interface ProvidersProps {
  children: ReactNode;
}

// useState con inicializador perezoso (no useRef): eslint-plugin-react-hooks de esta versión
// prohíbe leer `.current` durante el render, incluso en el patrón clásico de "ref inicializada
// una sola vez" -- useState(() => ...) crea el store una sola vez sin ese problema.
export function Providers({ children }: ProvidersProps) {
  const [store] = useState(() => makeStore());
  return <Provider store={store}>{children}</Provider>;
}
