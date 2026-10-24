export const PROMPT_VERSION = '1.0.0';

export const SYSTEM_PROMPT = `You are an expert software engineer and test-driven development (TDD) specialist.
Your task is to generate or repair the minimal implementation source code required to make tests pass.

Strict constraints:
1. ONLY modify or create implementation files. NEVER modify, delete, or weaken test files.
2. Respect the project's module system:
   - For ESM (type="module"): use "export function / export default / import".
   - For CommonJS: use "module.exports = { ... } / require(...)".
3. If the project is TypeScript, preserve valid TypeScript types and syntax.
4. Make the smallest, cleanest targeted change that satisfies all assertions.
5. Preserve all existing unrelated functions and comments in the implementation file.
6. Do NOT invent new external dependencies or assume uninstalled packages.
7. Return ONLY valid JSON adhering strictly to the JSON schema.`;

/**
 * Builds user prompt string from context payload
 * @param {object} context Context produced by context-builder
 * @returns {string}
 */
export function buildUserPrompt(context) {
  const parts = [];

  parts.push(`## Project Environment`);
  parts.push(`- Module Type: ${context.projectMeta.moduleType}`);
  parts.push(`- TypeScript: ${context.projectMeta.isTypeScript ? 'Yes' : 'No'}`);
  parts.push(`- Test Framework: ${context.projectMeta.testFramework}`);
  if (context.projectMeta.packageJson) {
    parts.push(`- Dependencies: ${context.projectMeta.packageJson.dependencies.join(', ') || 'none'}`);
  }

  parts.push(`\n## Test File (${context.testFile.path})`);
  parts.push('```' + (context.testFile.isTypeScript ? 'typescript' : 'javascript'));
  parts.push(context.testFile.content);
  parts.push('```');

  if (context.testFailures) {
    parts.push(`\n## Recent Test Failure Details`);
    if (context.testFailures.failedTests && context.testFailures.failedTests.length > 0) {
      parts.push(`Failed Tests:\n- ${context.testFailures.failedTests.join('\n- ')}`);
    }
    if (context.testFailures.assertionErrors && context.testFailures.assertionErrors.length > 0) {
      parts.push(`Assertion Errors:\n${context.testFailures.assertionErrors.join('\n')}`);
    }
    if (context.testFailures.stackTraces && context.testFailures.stackTraces.length > 0) {
      parts.push(`Stack Traces:\n${context.testFailures.stackTraces.slice(0, 3).join('\n---\n')}`);
    }
  }

  parts.push(`\n## Implementation Files`);
  if (context.implementationFiles.length === 0) {
    parts.push(`(No existing implementation file found. Identify target path from test import and create it.)`);
  } else {
    for (const file of context.implementationFiles) {
      if (file.exists) {
        parts.push(`\nExisting file: "${file.path}"`);
        parts.push('```' + (file.path.endsWith('.ts') ? 'typescript' : 'javascript'));
        parts.push(file.content || '// empty file');
        parts.push('```');
      } else {
        parts.push(`\nMissing target file to create: "${file.path}"`);
      }
    }
  }

  parts.push(`\n## Output Format Instructions`);
  parts.push(`Respond with a JSON object containing:
- "summary": A concise 1-sentence description of the change.
- "edits": Array of objects, each containing:
  - "path": Relative repository path of the implementation file (e.g. "src/calculator.js"). NEVER a test file.
  - "operation": "create" or "replace".
  - "content": Full replacement source code for this file.
  - "reason": Why this edit is necessary.
- "questions": Optional array of questions if requirements are ambiguous.`);

  return parts.join('\n');
}

export const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'Brief summary of the proposed changes'
    },
    edits: {
      type: 'array',
      description: 'List of file edits',
      items: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path to implementation file'
          },
          operation: {
            type: 'string',
            enum: ['create', 'replace', 'patch'],
            description: 'Edit operation type'
          },
          content: {
            type: 'string',
            description: 'Full file content or replacement content'
          },
          reason: {
            type: 'string',
            description: 'Justification for this change'
          }
        },
        required: ['path', 'operation', 'content', 'reason'],
        additionalProperties: false
      }
    },
    questions: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['summary', 'edits'],
  additionalProperties: false
};
