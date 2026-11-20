import { Context, Layer, Semaphore } from "effect";
import type { UserConfig } from "../../shared/schema/config";
import type { UserStyleProblem, UserStyleSource } from "../user-styles";

/** The process-wide modules a config or a style change reaches. */
export interface ApplyTargets {
  config(config: UserConfig): Promise<void>;
  styles(sources: ReadonlyArray<UserStyleSource>): ReadonlyArray<UserStyleProblem>;
}

/**
 * Applies configs one at a time. Without the lock, two saves during a slow
 * blocker fetch would race, and whichever finished last would be in charge
 * instead of whichever the user wrote last.
 */
export class ConfigApplier extends Context.Service<
  ConfigApplier,
  { readonly lock: Semaphore.Semaphore; targets: ApplyTargets | undefined }
>()("kvist/ConfigApplier") {
  static layer = Layer.sync(ConfigApplier, () => ({
    lock: Semaphore.makeUnsafe(1),
    targets: undefined,
  }));
}
