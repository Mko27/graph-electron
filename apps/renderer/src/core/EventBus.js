/**
 * EventBus — Observer Pattern
 *
 * Central event system that decouples components.
 * Components emit events when state changes, and other
 * components subscribe to react accordingly.
 *
 * Events:
 *   connection:state   — Connection state changed
 *   query:executing     — Query execution started
 *   query:results       — Query returned results
 *   query:error         — Query execution failed
 *   schema:loaded       — Schema data loaded
 *   schema:error        — Schema loading failed
 *   status:update       — Status bar message update
 *   history:updated     — Query history changed
 *   command:executed    — A command was executed
 *   command:undone      — A command was undone
 *   command:redone      — A command was redone
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Array<Function>>} */
    this.listeners = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} event — Event name
   * @param {Function} callback — Handler function
   * @returns {Function} Unsubscribe function
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
    return () => this.off(event, callback);
  }

  /**
   * Unsubscribe from an event.
   * @param {string} event — Event name
   * @param {Function} callback — Handler to remove
   */
  off(event, callback) {
    const list = this.listeners.get(event);
    if (list) {
      this.listeners.set(event, list.filter(cb => cb !== callback));
    }
  }

  /**
   * Emit an event to all subscribers.
   * @param {string} event — Event name
   * @param {*} data — Event payload
   */
  emit(event, data) {
    const list = this.listeners.get(event);
    if (list) {
      list.forEach(cb => {
        try {
          cb(data);
        } catch (err) {
          console.error(`[EventBus] Error in handler for '${event}':`, err);
        }
      });
    }
  }

  /**
   * Subscribe to an event, but only trigger once.
   * @param {string} event — Event name
   * @param {Function} callback — Handler function
   * @returns {Function} Unsubscribe function
   */
  once(event, callback) {
    const wrapper = (data) => {
      this.off(event, wrapper);
      callback(data);
    };
    return this.on(event, wrapper);
  }

  /**
   * Remove all listeners (useful for cleanup/testing).
   */
  clear() {
    this.listeners.clear();
  }
}

