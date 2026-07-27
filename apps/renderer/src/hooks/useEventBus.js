/**
 * React hooks for integrating with the EventBus (Observer pattern).
 *
 * Bridges the imperative EventBus with React's declarative model:
 *  - useEventBus(): subscribe to events, auto-cleanup on unmount
 *  - useEmit(): get a stable emit function
 */

import { useEffect, useCallback, useRef } from 'react';

/**
 * Subscribe to an EventBus event. The handler is automatically
 * unsubscribed when the component unmounts.
 *
 * @param {import('../core/EventBus.js').EventBus} eventBus
 * @param {string} event — Event name
 * @param {Function} handler — Event handler
 */
export function useEventBus(eventBus, event, handler) {
  // Use a ref to keep the latest handler without re-subscribing
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!eventBus || !event) return;

    const stableHandler = (data) => handlerRef.current(data);
    const unsubscribe = eventBus.on(event, stableHandler);
    return unsubscribe;
  }, [eventBus, event]);
}

/**
 * Get a stable emit function for the EventBus.
 *
 * @param {import('../core/EventBus.js').EventBus} eventBus
 * @returns {(event: string, data?: any) => void}
 */
export function useEmit(eventBus) {
  return useCallback(
    (event, data) => {
      if (eventBus) eventBus.emit(event, data);
    },
    [eventBus]
  );
}

