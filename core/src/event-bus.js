import { EventEmitter } from "node:events";

export class CoreEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  publish(eventName, payload = {}) {
    this.emit(eventName, Object.freeze({
      event: eventName,
      occurredAt: new Date().toISOString(),
      ...payload
    }));
  }
}
