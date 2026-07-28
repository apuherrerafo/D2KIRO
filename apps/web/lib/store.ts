import { configureStore } from "@reduxjs/toolkit";
import { engineApi } from "./engine-api";

// Store por-instancia (no un singleton a nivel de módulo) -- App Router puede renderizar en el
// servidor, y un store compartido entre requests filtraría estado entre usuarios distintos.
export function makeStore() {
  return configureStore({
    reducer: { [engineApi.reducerPath]: engineApi.reducer },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(engineApi.middleware),
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
