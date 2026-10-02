import type { ApiEvent, EntityName, Unsubscribe } from "@/lib/api/contract";

type Listener = (event: ApiEvent) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): Unsubscribe {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emit(
  entities: EntityName[],
  ids: Omit<ApiEvent, "entities"> = {},
): void {
  if (entities.length === 0) return;
  const unique = [...new Set(entities)];
  for (const listener of [...listeners]) {
    try {
      listener({ ...ids, entities: [...unique] });
    } catch {
      // A faulty listener must not prevent the others from being notified.
    }
  }
}

export function listenerCount(): number {
  return listeners.size;
}
