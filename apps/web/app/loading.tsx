// Estado de carga de cualquier ruta mientras el servidor resuelve la pantalla. Es texto visible, no un vacío.
export default function Loading() {
  return (
    <main className="ap-main ap-main--center" data-testid="route-loading" aria-busy="true">
      <p className="ap-loading" role="status">
        Cargando…
      </p>
    </main>
  );
}
