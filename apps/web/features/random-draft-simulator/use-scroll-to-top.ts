import { useEffect } from "react";

// Al arrancar el draft (el botón "Iniciar Draft" está al final de un formulario largo) y al empezar
// cada ronda, la pantalla nueva quedaba abierta a mitad de página: el jugador no veía la instrucción
// de la ronda. Sube al inicio cada vez que `key` cambia (ronda nueva), y también al montar.
export function useScrollToTop(key: number): void {
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [key]);
}
