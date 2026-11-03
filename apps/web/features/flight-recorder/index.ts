// Flight Recorder -- diagnóstico temporal del simulador (sólo preview/debug).
export { FlightRecorderPanel } from "./components/FlightRecorderPanel";
export { flightRecorder, createFlightRecorder, type FlightRecorder } from "./recorder";
export { isFlightRecorderBuilt, isFlightRecorderEnabled, FLIGHT_RECORDER_QUERY_PARAM } from "./config";
export { FLIGHT_RECORDER_SCHEMA, type FlightExport, type FlightEntry } from "./types";
