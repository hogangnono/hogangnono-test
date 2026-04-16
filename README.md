# hogangnono-test

Toy projects, prototypes, and one-off experiments live here first.

## Purpose

This repository is an incubator for lightweight experiments.

Instead of creating a new repository for every small idea, multiple projects can
start here with low overhead. Projects that survive the experiment stage should
be promoted into their own repositories.

## Repository Policy

- Keep all projects under `projects/<project-name>`.
- Treat each project as self-contained.
- Avoid root-level dependencies unless they are clearly shared.
- Update the root index when a new project is added.
- Use this repo for fast validation, not long-term production ownership.

## Recommended Structure

```text
.
|-- README.md
`-- projects/
    `-- <project-name>/
        |-- README.md
        |-- .env.example
        |-- package.json / pyproject.toml / requirements.txt
        `-- src/
```

## How To Add A New Project

1. Create a directory under `projects/`.
2. Add a local `README.md` with the purpose, setup, and run instructions.
3. Keep configuration and dependencies inside that project directory.
4. If environment variables are needed, provide `.env.example`.
5. Add the project to the index below.

## When To Split Into A Separate Repository

Move a project out when at least two of the following become true:

- It needs its own deployment lifecycle.
- It needs separate CI/CD, secrets, or infrastructure.
- Other people need to review or contribute independently.
- It survives beyond the short experiment stage.
- Its tech stack or tooling conflicts with other projects here.

## Project Index

| Project | Status | Summary |
| --- | --- | --- |
| TBD | planned | First experiment not added yet |

## Working Notes

- Keep the root simple.
- Promote survivors.
- Archive dead ends.
