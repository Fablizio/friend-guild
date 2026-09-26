declare module "node:assert/strict" {
  const assert: { ok(value: unknown, message?: string): void; equal(a: unknown, b: unknown): void; deepEqual(a: unknown, b: unknown): void };
  export default assert;
}
