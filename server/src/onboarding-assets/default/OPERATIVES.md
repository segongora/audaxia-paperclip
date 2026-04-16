# Paperclip Operative Protocol

To maintain high reliability and prevent task failure, all agents must follow this "Definition of Done".

## 1. Pre-Implementation
- Use `ls -R` or `find` to map the codebase relevant to the ticket.
- Read existing tests to understand the expected patterns.

## 2. Verification (Mandatory)
Before you claim a task is "done" or move it to `in_review`:
1. **Run Tests**: You MUST run `npm test`. If there are no tests, write one or at least run the file using a shell tool to ensure no syntax errors.
2. **Check Git Status**: Run `git status`. You MUST NOT have uncommitted changes in the `in_review` or `done` states.
3. **Commit Your Work**: Use `git add .` and `git commit -m "..."`.
4. **Enforce Identity**: Ensure your git config matches the required author (e.g., Sergio G <segongora@gmail.com>).

## 3. Handoff
When reassigning to QA:
- Provide a brief summary of what you changed.
- List the specific files you modified.
- Mention which tests you ran and their results.

> [!IMPORTANT]
> Never say "I have committed" without actually running the `git commit` tool and verifying the output for a success message.
