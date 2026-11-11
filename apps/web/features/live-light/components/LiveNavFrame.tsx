"use client";

import type { ReactNode } from "react";
import { SimulatorLightScope } from "@/features/simulator-light";
import "../live-page.css";

// <Dominio><Cosa>: marco Canonical Light de la barra de navegación compartida. Solo se monta en /live-draft (NavBar lo carga de forma diferida):
// el resto de las rutas conserva su barra tal cual. La barra no se redibuja -- es la misma `<nav>`; el alcance hace que sus nombres semánticos apunten a tokens Light.

export default function LiveNavFrame({ children }: { children: ReactNode }) {
  return (
    <div className="ll-nav" data-testid="live-nav-light">
      <SimulatorLightScope variant="strip">{children}</SimulatorLightScope>
    </div>
  );
}
