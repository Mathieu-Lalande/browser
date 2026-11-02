/**
 * A set of listeners for one kind of event: `on` subscribes (and returns the unsubscribe
 * function), `emit` calls every listener subscribed when it starts, in subscription order.
 */
export class Emitter<T = void> {
  private readonly listeners = new Set<(value: T) => void>();

  /** Subscribes `listener`; the returned function unsubscribes it. */
  on(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) listener(value);
  }

  get size(): number {
    return this.listeners.size;
  }
}
