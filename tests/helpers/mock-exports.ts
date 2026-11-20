import type { mock } from "node:test";

type ModuleMockOptions = NonNullable<Parameters<typeof mock.module>[1]>;

/**
 * mock.module() options that work on every Node line CI runs.
 *
 * Node 22 only understands `namedExports`; from Node 24 the option is
 * `exports`, Node 26 deprecates `namedExports`, and passing both throws.
 */
export function mockExports(exports: Record<string, unknown>): ModuleMockOptions {
  const major = Number(process.versions.node.split(".")[0]);
  return (major >= 24 ? { exports } : { namedExports: exports }) as ModuleMockOptions;
}
