import { BaseProvider } from './base.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import { maskSecrets } from '../utils/security.js';

export class OpenAIProvider extends BaseProvider {
  constructor(config = {}) {
    super('openai', config);
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    this.baseUrl = (config.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.model = config.model || 'gpt-4.1-mini';
    this.maxRetries = config.maxRetries ?? 3;
    this.timeoutMs = config.timeoutMs ?? 60000;
  }

  validateConfiguration() {
    if (!this.apiKey || typeof this.apiKey !== 'string' || this.apiKey.trim().length === 0) {
      throw new Error(
        'OpenAI API key is missing. Set the OPENAI_API_KEY environment variable or specify "apiKey" in configuration.'
      );
    }
    if (!this.model || typeof this.model !== 'string') {
      throw new Error('A valid model name must be specified for OpenAI provider.');
    }
  }

  /**
   * Helper to execute fetch with exponential backoff for transient errors
   * @private
   */
  async _fetchWithBackoff(url, requestOptions, attempt = 1) {
    try {
      const response = await fetch(url, requestOptions);

      if (response.ok) {
        return response;
      }

      // Handle specific HTTP error status codes
      const status = response.status;
      const errorText = await response.text();
      let parsedError = null;
      try {
        parsedError = JSON.parse(errorText);
      } catch {}

      const serverMessage = parsedError?.error?.message || errorText;

      if (status === 401) {
        throw new Error(`Authentication error: Invalid OpenAI API key. (${serverMessage})`);
      }
      if (status === 403) {
        throw new Error(`Access forbidden: Check API key permissions. (${serverMessage})`);
      }
      if (status === 404) {
        throw new Error(`Endpoint or model "${this.model}" not found. (${serverMessage})`);
      }

      const isTransient = status === 429 || (status >= 500 && status <= 504);

      if (isTransient && attempt <= this.maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000 + Math.floor(Math.random() * 500);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this._fetchWithBackoff(url, requestOptions, attempt + 1);
      }

      if (status === 429) {
        throw new Error(`Rate limit or quota exceeded from OpenAI: ${serverMessage}`);
      }

      throw new Error(`OpenAI API error (HTTP ${status}): ${serverMessage}`);
    } catch (err) {
      // Re-throw handled errors
      if (err.name === 'AbortError') {
        throw new Error(`OpenAI request timed out after ${this.timeoutMs}ms.`);
      }
      if (attempt <= this.maxRetries && (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND')) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return this._fetchWithBackoff(url, requestOptions, attempt + 1);
      }
      throw new Error(`Network failure connecting to OpenAI: ${maskSecrets(err.message)}`);
    }
  }

  async generateEdits(context, options = {}) {
    this.validateConfiguration();

    const userPrompt = buildUserPrompt(context);
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ];

    const body = {
      model: this.model,
      messages,
      temperature: 0.1,
      response_format: { type: 'json_object' }
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this._fetchWithBackoff(
        `${this.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          body: JSON.stringify(body),
          signal: controller.signal
        }
      );

      const json = await response.json();
      const content = json.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('OpenAI returned an empty response.');
      }

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (err) {
        throw new Error(`Failed to parse AI response as JSON: ${err.message}\nRaw content: ${content.slice(0, 300)}`);
      }

      const usage = json.usage ? {
        promptTokens: json.usage.prompt_tokens || 0,
        completionTokens: json.usage.completion_tokens || 0,
        totalTokens: json.usage.total_tokens || 0
      } : { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      return {
        summary: parsed.summary || 'Code modifications generated',
        edits: Array.isArray(parsed.edits) ? parsed.edits : [],
        questions: Array.isArray(parsed.questions) ? parsed.questions : [],
        usage
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
