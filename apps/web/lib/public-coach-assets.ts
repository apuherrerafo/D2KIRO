// Landing V2 (logged-out visitors): ONLY the Coach assets the page itself requests, as exact shapes (no prefix): the Motion V2 production pack at 384 px
// (manifest + content-hashed AVIF chunks) and the static Coach stills (Hero / Memory / reconstruct). Nothing else under /coach-motion-v2 (lab packs, 512 px,
// calibration, review artifacts) or /coach-gold-master (the Three.js model) is reachable without a session.
const PUBLIC_COACH_ASSET = /^\/(?:coach-motion-v2\/prod\/384\/(?:manifest\.json|[a-z]+(?:-[a-z]+)?-\d+\.[0-9a-f]{12}\.avif)|coach-web-pack\/(?:hero|memory)\/[a-z]+-[a-z]+\.webp|coach-web-pack\/reconstruct-memory\.webp)$/;

export function isPublicCoachAsset(pathname: string): boolean {
  return PUBLIC_COACH_ASSET.test(pathname);
}
