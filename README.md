# hogangnono-test

Toy projects, prototypes, and one-off experiments live here first.

This repository is an incubator. Start small here, validate quickly, then move
surviving projects into dedicated repositories when they outgrow the experiment
stage.

## What This Repository Is For

Use this repository when:

- the idea is still experimental
- the project may be short-lived
- the setup cost of a separate repository is not worth it yet
- you want multiple small projects in one place with minimal overhead

Do not use this repository for:

- production services
- long-lived team-owned applications
- projects that already need separate CI/CD, secrets, or deployment ownership

## Ground Rules

- Every project must live under `projects/<project-name>`.
- Every project must be self-contained.
- Do not add project code at the repository root.
- Do not add root-level dependencies unless they are shared by multiple projects.
- Do not commit secrets. Commit `.env.example` instead of `.env`.
- When adding a project, update the `Project Index` in this file.

## Recommended Structure

```text
.
|-- README.md
|-- .gitignore
`-- projects/
    `-- <project-name>/
        |-- README.md
        |-- .env.example
        |-- package.json / pyproject.toml / requirements.txt
        |-- src/
        `-- test/
```

## Quick Start

If you are uploading a new toy project, do exactly this:

1. Pick a folder name in `kebab-case`.
2. Create `projects/<project-name>/`.
3. Put all code, config, and assets inside that folder.
4. Add a project-level `README.md`.
5. Add `.env.example` if the project uses environment variables.
6. Add the runtime manifest that matches the stack.
7. Update the `Project Index` below.

Example:

```text
projects/hgnn-incident-assistant/
projects/slack-message-lab/
projects/address-parser-demo/
```

Minimal scaffold example:

```sh
mkdir -p projects/my-project/{src,test}
touch projects/my-project/README.md
touch projects/my-project/.env.example
```

## Required Files Per Project

Each project should include these files unless there is a clear reason not to:

- `README.md`: what it is, why it exists, how to run it
- `.env.example`: required environment variables without real secrets
- stack manifest: `package.json`, `pyproject.toml`, or `requirements.txt`
- `src/`: application source code
- `test/` or equivalent test location if the project has tests

## Project Naming Rules

- Use `kebab-case`.
- Keep the name short and descriptive.
- Prefer names that describe the experiment, not the final product vision.
- Avoid generic names like `test`, `demo`, or `tmp`.

Good examples:

- `incident-assistant`
- `slack-collector-lab`
- `address-parser-demo`

Bad examples:

- `test`
- `new-project`
- `temp-final-real`

## Project README Template

Every project under `projects/` should have a local `README.md` that follows
this shape:

```md
# <project-name>

## What It Is
One-paragraph summary of the project.

## Why It Exists
What question, workflow, or hypothesis this project is testing.

## Stack
- Node.js / Python / etc.
- Main libraries or frameworks

## How To Run
1. Setup steps
2. Install dependencies
3. Start command

## Environment Variables
- List required variables
- Point to `.env.example`

## Current Status
planned / active / paused / archived / promoted

## Next Steps
- Short list of the next things to validate
```

If a person reads the project `README.md`, they should be able to answer:

- what this project does
- why it exists
- how to run it
- what is still incomplete

## Definition Of Done For Adding A Project

Before merging a new project into this repository, verify all of these:

- the project is inside `projects/<project-name>`
- the project has its own `README.md`
- the project has no real secrets committed
- the setup instructions are reproducible from the project folder
- the root `Project Index` has been updated

## Status Values

Use one of these values in the root index and in each project README:

- `planned`: idea exists, implementation not started
- `active`: currently being explored or built
- `paused`: intentionally stopped for now
- `archived`: experiment ended, kept only for reference
- `promoted`: moved into its own repository

## When To Split Into A Separate Repository

Move a project out when at least two of the following are true:

- it needs its own deployment lifecycle
- it needs separate CI/CD, secrets, or infrastructure
- other people need to review or contribute independently
- it survives beyond the short experiment stage
- its tech stack or tooling conflicts with other projects here

## Project Index

Add one row per project.

| Project | Status | Summary | Path |
| --- | --- | --- | --- |
| hgnn-incident-assistant | active | Local Slack bot that analyzes AlertNow incidents with repository context | `projects/hgnn-incident-assistant` |

Example row:

```md
| incident-assistant | active | Slack-based incident response assistant | `projects/incident-assistant` |
```

## Repository Maintenance Rules

- Keep the repository root minimal.
- Prefer deleting dead code over keeping half-finished clutter.
- Promote survivors into dedicated repositories.
- Archive finished experiments instead of pretending they are active.
