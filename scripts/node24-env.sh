#!/usr/bin/env bash
# Put nvm's Node 24 FIRST on PATH for this shell — or fail, loudly, and change
# nothing. Source it; never run it:
#
#   . scripts/node24-env.sh            # use the installed Node 24
#   . scripts/node24-env.sh --install  # install it under nvm first, then use it
#
# Why this exists (.cursor/environment.json, PR #23): the Cloud Agent harness
# puts /exec-daemon — which carries its own Node 22 — AHEAD of nvm on PATH.
# `nvm use 24` does not move nvm ahead of it: when PATH already holds an nvm
# bin directory, nvm only swaps that entry in place, so `node` still resolves
# to /exec-daemon/node and the CMS (engines >= 24) boots on 22 while CI runs
# 24. The first fix prepended `$(dirname "$(nvm which 24)")`; with no Node 24
# that expands to `.` and puts the working directory first on PATH. This one
# refuses instead: PATH is touched only after the binary was found and is the
# major asked for. Scoped to the sourcing shell — nothing global is written.

node24_env() {
  local want="${TAPUZ_NODE_MAJOR:-24}"
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    echo "node24-env: nvm not found at $NVM_DIR/nvm.sh" >&2
    return 1
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" || { echo "node24-env: could not load nvm" >&2; return 1; }
  if [ "${1:-}" = "--install" ]; then
    nvm install "$want" >&2 || { echo "node24-env: nvm install $want failed" >&2; return 1; }
    nvm alias default "$want" >/dev/null 2>&1 || true
  fi
  # a failed `nvm use` leaves NVM_BIN as it was (possibly a stale export from
  # the harness), so the result is checked on disk, not trusted from the variable
  if ! nvm use "$want" >/dev/null 2>&1; then
    echo "node24-env: Node $want is not installed under nvm — run \`. scripts/node24-env.sh --install\`" >&2
    return 1
  fi
  local bin="${NVM_BIN:-}"
  if [ -z "$bin" ] || [ ! -x "$bin/node" ]; then
    echo "node24-env: nvm did not resolve a node binary (NVM_BIN='$bin')" >&2
    return 1
  fi
  local v
  v="$("$bin/node" --version 2>/dev/null)"
  case "$v" in
    v"$want".*) ;;
    *) echo "node24-env: $bin/node is '$v', not Node $want" >&2; return 1 ;;
  esac
  export PATH="$bin:$PATH"
  echo "node24-env: $(node --version) at $(command -v node)" >&2
  return 0
}

node24_env "$@"
