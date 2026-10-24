/**
 * Base AI Provider Interface
 */
export class BaseProvider {
  /**
   * @param {string} name Provider name (e.g., 'openai', 'mock')
   * @param {object} config Configuration
   */
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
  }

  /**
   * Validates provider configuration (API keys, endpoint, etc.)
   * @throws {Error} If configuration is invalid
   */
  validateConfiguration() {
    throw new Error(`validateConfiguration not implemented for ${this.name}`);
  }

  /**
   * Generate code edits based on context
   * @param {object} context Context object from context-builder
   * @param {object} [options]
   * @returns {Promise<{
   *   summary: string,
   *   edits: Array<{ path: string, operation: string, content: string, reason: string }>,
   *   questions?: string[],
   *   usage?: { promptTokens: number, completionTokens: number, totalTokens: number }
   * }>}
   */
  async generateEdits(context, options = {}) {
    throw new Error(`generateEdits not implemented for ${this.name}`);
  }
}
