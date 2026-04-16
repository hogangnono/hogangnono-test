#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/new-project.sh <project-name>

Example:
  ./scripts/new-project.sh address-parser-demo
EOF
}

if [ "$#" -ne 1 ]; then
  usage >&2
  exit 1
fi

project_name="$1"

if [[ ! "$project_name" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "Project name must be kebab-case: $project_name" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project_dir="$repo_root/projects/$project_name"
template_dir="$repo_root/templates/project"

if [ -e "$project_dir" ]; then
  echo "Project already exists: $project_dir" >&2
  exit 1
fi

mkdir -p "$project_dir/src" "$project_dir/test"

render_template() {
  local source_file="$1"
  local target_file="$2"

  sed "s/__PROJECT_NAME__/$project_name/g" "$source_file" > "$target_file"
}

render_template "$template_dir/README.md.template" "$project_dir/README.md"
render_template "$template_dir/README.ko.md.template" "$project_dir/README.ko.md"
render_template "$template_dir/.env.example.template" "$project_dir/.env.example"

touch "$project_dir/src/.gitkeep" "$project_dir/test/.gitkeep"

cat <<EOF
Created project scaffold:
  $project_dir

Files:
  projects/$project_name/README.md
  projects/$project_name/README.ko.md
  projects/$project_name/.env.example
  projects/$project_name/src/.gitkeep
  projects/$project_name/test/.gitkeep

Next:
  1. Fill both README files.
  2. Add stack-specific files such as package.json or pyproject.toml.
  3. Update the root Project Index in README.md and README.ko.md.
EOF
