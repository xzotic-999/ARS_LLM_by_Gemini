// Missing type declarations for third-party packages without bundled .d.ts files.
// These are runtime packages whose JS works correctly; this file gives TypeScript
// a permissive type so the app compiles without installing @types/* packages.

declare module "connect-pg-simple";

declare module "bcrypt";