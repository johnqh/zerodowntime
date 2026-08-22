/**
 * Staged-failure trigger for the demo. Arming it makes the NEXT search parse
 * treat every row as a schema violation, which drives the real detection ->
 * heal -> recovery chain. The break is synthetic; nothing downstream of it is.
 *
 * The rest of this module (handleDegraded, buildHealPrompt) lands in Phase 4.
 */
export interface FailureInjector {
  arm(): void;
  consume(): boolean;
}

export const createFailureInjector = (): FailureInjector => {
  let armed = false;
  return {
    arm() {
      armed = true;
    },
    consume() {
      if (!armed) return false;
      armed = false;
      return true;
    },
  };
};
