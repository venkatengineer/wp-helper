# Missing Function Example Project

This is an example project demonstrating how `ai-test-fixer` inspects test failures, generates the missing function implementation, and repairs the project until tests pass.

## Structure

- `src/calculator.js` contains `subtract()`, but is missing `add()`.
- `test/calculator.test.js` tests both `subtract()` and `add()`.

## Running with ai-test-fixer

1. Run check to view baseline test failure:
   ```bash
   npx ai-test-fixer check
   ```

2. Generate a plan without modifying files:
   ```bash
   npx ai-test-fixer plan
   ```

3. Automatically repair with AI:
   ```bash
   export OPENAI_API_KEY="your-api-key"
   npx ai-test-fixer fix --apply
   ```
