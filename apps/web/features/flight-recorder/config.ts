// Doble interruptor explícito. Sin AMBOS la grabadora ni se arma ni se muestra:
//  1. BUILD: `NEXT_PUBLIC_D2_FLIGHT_RECORDER=1` al construir (Next lo inlinea; en producción queda en `undefined`).
//  2. SESIÓN: la URL lleva `?flightRecorder=1`.

export const FLIGHT_RECORDER_QUERY_PARAM = "flightRecorder";

export function isFlightRecorderBuilt(value: string | undefined = process.env.NEXT_PUBLIC_D2_FLIGHT_RECORDER): boolean {
  return value === "1";
}

export function isFlightRecorderRequested(search: string): boolean {
  return new URLSearchParams(search).get(FLIGHT_RECORDER_QUERY_PARAM) === "1";
}

export function isFlightRecorderEnabled(search: string, built: boolean = isFlightRecorderBuilt()): boolean {
  return built && isFlightRecorderRequested(search);
}
