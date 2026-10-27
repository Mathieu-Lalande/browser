/**
 * Focus for the search field: it is mounted with the sheet (before its slide-in animation), and
 * focused once its first layout is done, on the next frame. Focusing during the mount (autoFocus)
 * raised the keyboard while the field was still moving, and the first typed character could be lost.
 */
export function focusOnFirstLayout(focus: () => void, schedule: (run: () => void) => void = (run) => requestAnimationFrame(run)): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    schedule(focus);
  };
}
