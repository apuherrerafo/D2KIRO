// Intentionally empty module.
//
// R1's public hashing surface is purpose-specific and lives in identity-hash.ts. Canonical JSON,
// SHA-256, and functional-noise stripping are private implementation details there so a deep
// import cannot recover a generic hashing authority.
export {};
