
default:
    just --list

run:
    npm run dev:api

test suite="all":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{suite}}" in
      all) npm test ;;
      unit|integration|e2e) npm run "test:{{suite}}" ;;
      *) echo "Unknown test suite: {{suite}} (expected unit, integration, e2e, or all)" >&2; exit 2 ;;
    esac

setup:
    npm install
    npm run check
