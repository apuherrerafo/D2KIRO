// Team Coach Board -- the ONE board shared by /simulator and /live-draft.
export { TeamCoachBoard, type TeamCoachBoardProps } from "./components/TeamCoachBoard";
export { LiveTeamCoachView } from "./components/LiveTeamCoachView";
export { LiveDotaView } from "./components/LiveDotaView";
export { fetchTeamBoard } from "./client";
export { parseTeamCoachBoard, parseLiveCaptureStatus } from "./validation";
export type { TeamCoachBoardData, TeamCoachColumn, TeamCoachCandidate, TeamPosition, LiveCaptureStatus, RequestStatus } from "./types";
