// Where a signed-in session lands when it did not ask for a particular page.
// Deep links still win: middleware records the intended path and the OAuth
// callback honours it before falling back to this.
export const DEFAULT_LANDING = "/timelines/quick-response";
