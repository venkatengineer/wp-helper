# ai-test-fixer

> AI-Powered Test-Driven Code Generation & Autonomous Test Repair Toolkit for JavaScript and TypeScript projects.

`ai-test-fixer` scans existing repositories for tests, analyzes failing assertions and module relationships, queries an AI provider to generate targeted implementation fixes, validates patches with strict security policies, displays unified diffs, applies approved changes, and executes the project's test suite in an autonomous repair loop until tests pass.

---

## Key Features

- 🎯 **Test-Driven Auto-Repair**: Generates or patches source files to satisfy failing test assertions.
- 🛡️ **Zero Test Weakening**: Strict safety validator prevents models from editing, deleting, or weakening test assertions to artificially make tests pass.
- 🧩 **Zero Dependencies**: Built entirely with Node.js standard libraries (`node:test`, `node:util`, `node:child_process`, `fetch`), ensuring ultra-fast downloads and zero supply-chain risk.
- 🔌 **Framework Adapters**: Out-of-the-box support for **Node.js built-in test runner** (`node --test`), **Jest**, **Vitest**, and **Mocha**, plus configurable custom commands.
- 📦 **Dual Module Compatibility**: Works with ECMAScript Modules (ESM) and CommonJS (CJS) projects, respecting `package.json` module definitions and TypeScript.
- ⏪ **Snapshots & Instant Rollback**: Creates atomic snapshots before any file modification, with single-command rollback support.
- 🔍 **Interactive & Dry-Run Modes**: Review unified diffs with `plan` or approve interactively before modifying files.
- 🔒 **Security Hardened**: Path traversal protection, symlink escape checks, repository root containment, and automatic masking of secrets and API keys.

---

## Requirements

- **Node.js**: `>= 18.0.0` (LTS or modern versions supported: 18, 20, 22+)
- **Package Manager**: Works seamlessly with `npm`, `pnpm`, or `yarn`.

---

## Quick Start

You can run `ai-test-fixer` inside any JavaScript or TypeScript project without installation using `npx`:

### 1. Set your AI provider API key

```bash
export OPENAI_API_KEY="your-api-key"
```

Optional custom endpoint (e.g., local Ollama, vLLM, LMStudio, OpenRouter):
```bash
export OPENAI_BASE_URL="http://localhost:11434/v1"
```

### 2. Discover tests in your project

```bash
npx ai-test-fixer scan
```

### 3. Generate a repair plan (Dry-Run mode, no files modified)

```bash
npx ai-test-fixer plan --test "test/calculator.test.js"
```

### 4. Run the repair loop

```bash
# Propose changes and prompt for approval:
npx ai-test-fixer fix

# Apply validated changes automatically:
npx ai-test-fixer fix --apply
```

---

## CLI Command Reference

| Command | Description |
|---|---|
| `npx ai-test-fixer` | Default safe command; inspects tests, proposes fixes, and asks for approval |
| `npx ai-test-fixer scan` | Discover test files, package manager, module type, and test framework without running tests or AI |
| `npx ai-test-fixer scan --json` | Output scan results as machine-readable JSON |
| `npx ai-test-fixer check` | Run the project test suite directly without invoking AI |
| `npx ai-test-fixer plan` | Dry-run: Analyze failures and AI response, display unified diff without modifying files |
| `npx ai-test-fixer fix` | Run the repair loop, displaying diffs and requesting confirmation before applying |
| `npx ai-test-fixer fix --apply` | Automatically apply validated patches and iterate until tests pass |
| `npx ai-test-fixer fix --test <path>` | Target a specific test file or glob pattern |
| `npx ai-test-fixer fix --max-attempts <n>` | Set maximum repair iterations (default: `3`) |
| `npx ai-test-fixer rollback` | Restore files to the state prior to the most recent repair |
| `npx ai-test-fixer rollback --list` | List all saved backup snapshots |
| `npx ai-test-fixer rollback --id <id>` | Restore files from a specific snapshot ID |
| `npx ai-test-fixer --help` | Display usage instructions and options |
| `npx ai-test-fixer --version` | Display version number |

### CLI Options & Flags

- `--apply`, `-y`, `--yes`: Apply changes without interactive confirmation prompt.
- `--test <pattern>`: Target a specific test file (e.g. `test/calculator.test.js`).
- `--max-attempts <n>`: Maximum number of AI repair attempts (default: 3).
- `--allow-dirty`: Allow running on a Git repository with uncommitted changes.
- `--json`: Output machine-readable JSON (supported by `scan`, `plan`, `check`).
- `--verbose`: Output detailed debug information and full error stack traces.
- `--quiet`: Suppress non-essential output.

---

## Configuration

You can customize `ai-test-fixer` by creating an `ai-test-fixer.config.json` (or `.ai-test-fixerrc.json`) in your project root:

```json
{
  "provider": "openai",
  "model": "gpt-4.1-mini",
  "maxAttempts": 3,
  "approvalRequired": true,
  "testPatterns": [
    "**/test.js",
    "**/test.cjs",
    "**/test.mjs",
    "**/test.ts",
    "**/*.test.js",
    "**/*.test.ts",
    "**/*.spec.js",
    "**/*.spec.ts",
    "**/__tests__/**"
  ],
  "exclude": [
    "node_modules/**",
    ".git/**",
    "dist/**",
    "build/**",
    "coverage/**",
    ".nyc_output/**",
    ".cache/**",
    ".ai-test-fixer/**"
  ],
  "maxFileBytes": 100000,
  "maxContextTokens": 32000,
  "testTimeoutMs": 120000,
  "allowDirty": false,
  "customTestCommand": null
}
```

### Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `provider` | string | `"openai"` | AI provider (`"openai"`, `"mock"`, or custom registered provider) |
| `model` | string | `"gpt-4.1-mini"` | Model name to invoke |
| `maxAttempts` | integer | `3` | Maximum repair iterations before stopping |
| `approvalRequired` | boolean | `true` | Require interactive approval before applying changes unless `--apply` is specified |
| `testPatterns` | string[] | Standard patterns | Glob patterns used to discover test files |
| `exclude` | string[] | Excluded directories | Directories and files ignored during repository scanning |
| `maxFileBytes` | integer | `100000` | Maximum size in bytes of individual source files included in context |
| `maxContextTokens` | integer | `32000` | Approximate token ceiling for context payloads |
| `testTimeoutMs` | integer | `120000` | Test command timeout in milliseconds |
| `allowDirty` | boolean | `false` | If false, warns when repository has uncommitted changes |
| `customTestCommand` | string \| null | `null` | Custom command to run tests (e.g. `"npm run test:unit"`) |

---

## Supported Runtimes & Frameworks

`ai-test-fixer` inspects existing package metadata and test configurations:

| Test Framework | Detection Method | Default Execution Command |
|---|---|---|
| **Node.js Test Runner** | `node --test` in package scripts, or default Node 18+ runner | `node --test <testFiles>` |
| **Jest** | `jest` in dependencies, `jest.config.*` | `npx jest --colors=false --runInBand <testFiles>` |
| **Vitest** | `vitest` in dependencies, `vitest.config.*` | `npx vitest run --no-color <testFiles>` |
| **Mocha** | `mocha` in dependencies, `.mocharc.*` | `npx mocha --no-colors <testFiles>` |
| **Custom / Unknown** | User specified via `customTestCommand` or unrecognized runner | Explicit command from `customTestCommand` |

---

## Safety & Security Policies

1. **Test Protection Rule**: The AI is strictly barred from modifying, deleting, or weakening test assertions. Proposed edits that target test files are rejected by the validator.
2. **Path Traversal & Symlink Protection**: Target paths are resolved and validated against the repository root. Null bytes, traversal (`../`), and symlinks resolving outside the repository are blocked.
3. **Prohibited Files Protection**: Sensitive files such as `.env`, `.pem`, `.key`, `id_rsa`, `.git`, and credentials are never included in context and cannot be edited.
4. **Secret Filtering**: API keys, bearer authorization tokens, and private keys are masked from all console logs and error output.
5. **No Model Shell Commands**: The model returns structured edits (`path`, `operation`, `content`, `reason`) validated against a strict JSON schema. It is never allowed to execute shell commands.
6. **Concurrent Change Detection**: SHA-256 hashes of files are verified prior to patching to prevent overwriting edits made between context analysis and patch application.
7. **Atomic Backups**: Every patch operation creates an atomic snapshot under `.ai-test-fixer/backups/`. If an error occurs midway through patching, changes are automatically rolled back.

---

## Example Walkthrough

An end-to-end fixture project is provided in `examples/missing-function-project/`.

### The Problem
`src/calculator.js` contains `subtract()`, but is missing `add()`:
```javascript
export function subtract(a, b) {
  return a - b;
}
```

The test `test/calculator.test.js` expects:
```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { add, subtract } from '../src/calculator.js';

test('add adds two numbers together', () => {
  assert.equal(add(2, 3), 5);
});
```

### The Fix Workflow

1. Check baseline:
   ```bash
   npx ai-test-fixer check
   # ✖ Tests failed with exit code 1 (TypeError: add is not a function)
   ```

2. Run repair loop:
   ```bash
   npx ai-test-fixer fix --apply
   # [1/4] Discovering test files...
   # [2/4] Running baseline test check...
   # ⚠ Baseline tests failed. Starting repair loop...
   # [3/4] Repair attempt [1/3] - Analyzing context & querying AI...
   # Proposed diff:
   # + export function add(a, b) {
   # +   return a + b;
   # + }
   # [4/4] Applying patch and re-testing [1/3]...
   # ✔ Tests passed successfully after 1 attempt(s)!
   ```

3. If you want to undo:
   ```bash
   npx ai-test-fixer rollback
   # ✔ Successfully rolled back to backup snapshot.
   ```

---

## Troubleshooting

- **`OpenAI API key is missing`**: Ensure `OPENAI_API_KEY` is set in your environment:
  ```bash
  export OPENAI_API_KEY="sk-..."
  ```
- **`Unknown test framework`**: Define `customTestCommand` in `ai-test-fixer.config.json`:
  ```json
  {
    "customTestCommand": "npm test"
  }
  ```
- **`Working tree has uncommitted changes`**: Either commit your working tree before repair or pass `--allow-dirty`.
- **`Test execution timed out`**: Adjust `testTimeoutMs` in `ai-test-fixer.config.json` (e.g. `180000` for 3 minutes).

---

## Packaging and Publishing Instructions

To test the package locally without publishing:

1. **Verify automated tests**:
   ```bash
   npm test
   ```

2. **Verify npm pack dry-run**:
   ```bash
   npm run pack:check
   ```

3. **Create a local tarball**:
   ```bash
   npm pack
   ```

4. **Test the tarball in another directory**:
   ```bash
   npx /path/to/ai-test-fixer-1.0.0.tgz scan
   ```

5. **Publish to npm registry (maintainers only)**:
   ```bash
   npm publish --access public
   ```

---

## License

MIT © ai-test-fixer contributors
