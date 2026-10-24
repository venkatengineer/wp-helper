import { BaseProvider } from './base.js';

export class MockProvider extends BaseProvider {
  /**
   * @param {object} [config={}]
   * @param {Array|object|Function} [config.responses]
   * @param {boolean} [config.shouldFail=false]
   * @param {string} [config.failMessage='Mock failure']
   */
  constructor(config = {}) {
    super('mock', config);
    this.responses = Array.isArray(config.responses)
      ? [...config.responses]
      : config.responses
        ? [config.responses]
        : [];
    this.handler = typeof config.handler === 'function' ? config.handler : null;
    this.callCount = 0;
    this.history = [];
    this.shouldFail = config.shouldFail ?? false;
    this.failMessage = config.failMessage ?? 'Mock provider simulated error';
  }

  validateConfiguration() {
    // Mock provider always passes configuration validation
    return true;
  }

  /**
   * Add a queued response
   * @param {object} response
   */
  queueResponse(response) {
    this.responses.push(response);
  }

  async generateEdits(context, options = {}) {
    this.callCount++;
    this.history.push({ context, options });

    if (this.shouldFail) {
      throw new Error(this.failMessage);
    }

    if (this.handler) {
      return this.handler(context, options, this.callCount);
    }

    if (this.responses.length > 0) {
      const resp = this.responses.shift();
      if (typeof resp === 'function') {
        return resp(context, options);
      }
      return resp;
    }

    // Default response when no mock queued
    return {
      summary: 'Default mock response: no changes needed',
      edits: [],
      questions: [],
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
    };
  }
}
