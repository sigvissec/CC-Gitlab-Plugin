// Setup checks the server makes once per session, unless they fail.

/**
 * Wraps a check so it runs once and its answer is reused, unless it fails: a setup the user can
 * still fix (signing glab in, upgrading it) is then checked again on the next call.
 */
export function onceItWorks<T>(check: () => Promise<T>): () => Promise<T> {
  let answer: Promise<T> | undefined;
  return () =>
    (answer ??= check().catch((error: unknown) => {
      answer = undefined;
      throw error;
    }));
}
