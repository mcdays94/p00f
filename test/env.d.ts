import type { Env } from "../src/worker/types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
