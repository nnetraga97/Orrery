# Handoff prompt for M0

Paste the block below into a coding agent started in an **empty folder** on the
machine that will do the work.

```text
You are setting up a project called Orrery in this empty folder. Your whole job is
to carry out one written plan, exactly.

1. Clone the repository into this folder:
   git clone https://github.com/nnetraga97/orrery.git .
2. Read docs/plans/m0-migration.md from top to bottom before running anything else.
   Then read sections 1, 3 and 4 of docs/design.md for context.
3. Do the plan's tasks in order, Task 0 through Task 6, one step at a time. Run each
   command exactly as written. Compare the output with the step's "Expected" text
   before moving on. Task 5 is marked DEFERRED: skip it.

How to work:
- The plan's "Rules" section is binding. In particular: do not edit anything under
  galaxy/, reference/, public/assets/ or public/data/; do not change the scripts in
  tools/; do not start any XR feature work; do not ask for or use any API key.
- The project generator in Task 1 installs its own AGENTS.md and skills that tell
  agents to start building an experience straight away. Ignore that instruction.
  This plan decides what you do.
- If a command's output does not match "Expected", if a script prints STOPPED, or
  if you would have to change a file the plan does not mention: stop. Tell me the
  task and step, paste the exact output, and wait for me. Do not guess a fix beyond
  the ones the plan lists.
- Commit after each task with the commit message the plan gives. Work on the branch
  m0-migration. Do not merge into main and do not open a pull request.
- Do not use any planning or workflow plugin. The plan is the plan.

When Task 6 is done, give me the report its last step asks for, then stop. Do not
begin the next milestone.
```

## Before you start

- Node 22.12 or newer (or Node 24), npm and git installed.
- About 2 GB of free disk: the clone is roughly 125 MB and `node_modules` about 700 MB.
- If the agent asks for permission to run `npm create @iwsdk@1.1.0-rc.2 ...` or
  `npx playwright install chromium`, approve it: both are steps of the plan.
- Nothing in this milestone needs a key or an account.
