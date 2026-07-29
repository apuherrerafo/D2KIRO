import Link from "next/link";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";

// TSK-029: primera pantalla real del sitio -- antes era el placeholder de create-next-app. Ofrece
// los 3 flujos principales explícitos del ticket; el resto de las rutas reales (heroes, meta)
// quedan siempre accesibles desde el NavBar compartido (RootLayout), no desde aquí.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-surface-base p-6 text-center">
      <span className="text-display text-content-primary">dota2coach</span>
      <span className="max-w-md text-body text-content-secondary">
        Sugerencias de draft en vivo para Dota 2, calculadas a partir de contrapick, meta del parche, sinergia de equipo y tu
        propio pool de héroes.
      </span>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/draft" className={BUTTON_PRIMARY}>
          Ver el draft en vivo
        </Link>
        <Link href="/hero-pool" className={BUTTON_SECONDARY}>
          Configurar mi pool de héroes
        </Link>
        <Link href="/settings" className={BUTTON_SECONDARY}>
          Configuración
        </Link>
      </div>
    </main>
  );
}
