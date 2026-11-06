#!/bin/sh
# Connects Claude Code to the RIM desktop app on this computer, or removes the connection.
#
#   pair.sh start [--replace]   asks RIM to pair and prints the code to compare
#   pair.sh wait                waits for the answer and, if approved, adds RIM to Claude Code
#   pair.sh disconnect          removes RIM from Claude Code
#
# Every command prints exactly one line, `KEY` or `KEY: text`. Output goes to a model, so the
# token and the poll secret are never printed: no tracing, no command output is forwarded, and
# every value taken from an answer is checked before it is used.
set -eu
umask 077

BASE_URL=${RIM_BRIDGE_URL:-http://127.0.0.1:47821}
WAIT_SECONDS=${RIM_PAIR_WAIT_SECONDS:-60}
POLL_SECONDS=2

STATE_DIR=${XDG_RUNTIME_DIR:-$HOME/.cache}/rim-claude-code
STATE_FILE=$STATE_DIR/pairing
WORK=

cleanup() {
  if [ -n "$WORK" ]; then rm -rf "$WORK"; fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

# Prints the one result line and ends with the given exit status.
say() {
  printf '%s\n' "$1"
  exit "${2:-0}"
}

# Makes the private directory for this run's request and answer files.
make_work() {
  WORK=$(mktemp -d "${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/rim-pair.XXXXXX") || say 'FAILED: RIM gave an answer this script doesn'"'"'t understand.' 1
}

# post PATH BODY_FILE: sends the file as JSON, leaves the answer in $WORK/body and its status in
# $STATUS ("000" when nothing answered). $CURL_RC is curl's exit status. curl's own messages are
# dropped, since they can repeat what it was given.
post() {
  CURL_RC=0
  STATUS=$(curl -sS --noproxy '*' --max-time 10 -X POST -H 'Content-Type: application/json' \
    --data-binary "@$2" -o "$WORK/body" -w '%{http_code}' "$BASE_URL$1" 2>/dev/null) || CURL_RC=$?
  [ "$CURL_RC" -eq 0 ] || STATUS=000
}

# field NAME: the string value of a top-level JSON field in the answer, or nothing.
field() {
  sed -n 's/.*"'"$1"'":"\([^"]*\)".*/\1/p' "$WORK/body" | head -n 1
}

# state_field NAME: the value saved in the pairing state, or nothing.
state_field() {
  sed -n 's/^'"$1"'=//p' "$STATE_FILE" | head -n 1
}

# is_id VALUE: whether VALUE is a non-empty run of letters, digits, '_' and '-'.
is_id() {
  case $1 in
    '' | *[!A-Za-z0-9_-]*) return 1 ;;
  esac
}

# is_code VALUE: whether VALUE is exactly six digits.
is_code() {
  case $1 in
    [0-9][0-9][0-9][0-9][0-9][0-9]) return 0 ;;
  esac
  return 1
}

# is_token VALUE: whether VALUE has the shape of an agent token.
is_token() {
  case $1 in
    rimagent_*) ;;
    *) return 1 ;;
  esac
  rest=${1#rimagent_}
  [ "${#rest}" -eq 43 ] && is_id "$rest"
}

BAD_ANSWER='FAILED: RIM gave an answer this script doesn'"'"'t understand.'

cmd_start() {
  replace=0
  [ "${1:-}" = "--replace" ] && replace=1
  if [ "$replace" -eq 0 ] && claude mcp get rim </dev/null >/dev/null 2>&1; then
    say 'ALREADY_CONNECTED: RIM is already set up in Claude Code.'
  fi
  make_work
  printf '{"name":"Claude Code"}' >"$WORK/request"
  post /pair "$WORK/request"
  case $STATUS in
    200) ;;
    000)
      case $CURL_RC in
        7 | 28) say 'NOT_LISTENING: RIM isn'"'"'t listening. Open the desktop app, then turn on Settings > Agents > Let agents on this computer connect.' ;;
      esac
      say "$BAD_ANSWER" 1
      ;;
    423) say 'LOCKED: RIM is locked. Unlock it in the desktop app, then try again.' ;;
    409) say 'IN_PROGRESS: RIM is already asking about another connection. Answer that first.' ;;
    429) say 'TRY_LATER: Wait ten seconds, then try again.' ;;
    403) say 'REFUSED_BY_BRIDGE: Something changed this request on its way to RIM.' ;;
    *) say "$BAD_ANSWER" 1 ;;
  esac
  request_id=$(field requestId)
  poll_secret=$(field pollSecret)
  code=$(field code)
  is_id "$request_id" && is_id "$poll_secret" && is_code "$code" || say "$BAD_ANSWER" 1
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  printf 'requestId=%s\npollSecret=%s\nreplace=%s\n' "$request_id" "$poll_secret" "$replace" >"$STATE_FILE"
  chmod 600 "$STATE_FILE"
  say "CODE: $(printf '%s' "$code" | cut -c1-3) $(printf '%s' "$code" | cut -c4-6)"
}

cmd_wait() {
  [ -f "$STATE_FILE" ] || say 'NOT_STARTED: Run start first.'
  request_id=$(state_field requestId)
  poll_secret=$(state_field pollSecret)
  replace=$(state_field replace)
  if ! is_id "$request_id" || ! is_id "$poll_secret"; then
    rm -f "$STATE_FILE"
    say 'NOT_STARTED: Run start first.'
  fi
  make_work
  printf '{"requestId":"%s","pollSecret":"%s"}' "$request_id" "$poll_secret" >"$WORK/request"
  waited=0
  while :; do
    post /pair/poll "$WORK/request"
    case $STATUS in
      200) ;;
      404)
        rm -f "$STATE_FILE"
        say 'EXPIRED: The request ran out. Nothing was changed.'
        ;;
      423 | 000)
        rm -f "$STATE_FILE"
        say 'LOCKED_OR_CLOSED: RIM closed or locked before this finished. Nothing was changed.'
        ;;
      *)
        rm -f "$STATE_FILE"
        say "$BAD_ANSWER" 1
        ;;
    esac
    answer=$(field status)
    case $answer in
      pending)
        if [ $((waited + POLL_SECONDS)) -gt "$WAIT_SECONDS" ]; then
          say 'PENDING: Still waiting for you to answer in RIM.'
        fi
        sleep "$POLL_SECONDS"
        waited=$((waited + POLL_SECONDS))
        ;;
      refused)
        rm -f "$STATE_FILE"
        say 'REFUSED: You chose not to connect. Nothing was changed.'
        ;;
      expired)
        rm -f "$STATE_FILE"
        say 'EXPIRED: The request ran out. Nothing was changed.'
        ;;
      approved) break ;;
      *)
        rm -f "$STATE_FILE"
        say "$BAD_ANSWER" 1
        ;;
    esac
  done
  token=$(field token)
  rm -f "$STATE_FILE"
  is_token "$token" || say "$BAD_ANSWER" 1
  if [ "$replace" = 1 ]; then
    claude mcp remove --scope user rim </dev/null >/dev/null 2>&1 || true
  fi
  if ! claude mcp add --transport http --scope user rim "${BASE_URL%/}/mcp" \
    --header "Authorization: Bearer $token" </dev/null >/dev/null 2>&1; then
    say 'COULD_NOT_ADD: RIM approved this, but Claude Code could not save it. Press Disconnect in RIM'"'"'s Settings > Agents, then try again.' 1
  fi
  say 'CONNECTED: RIM is set up. Restart Claude Code or run /mcp to use it.'
}

cmd_disconnect() {
  if claude mcp remove --scope user rim </dev/null >/dev/null 2>&1; then
    say 'REMOVED: RIM is removed from Claude Code. Press Disconnect in RIM'"'"'s Settings > Agents to end its access.'
  fi
  say 'NOT_SET_UP: RIM isn'"'"'t set up in Claude Code.'
}

# Only this computer: the address can be changed for tests, never to reach another machine.
case $BASE_URL in
  http://127.0.0.1:*) ;;
  *) say 'FAILED: RIM is only reached on this computer.' 1 ;;
esac

case ${1:-} in
  start) shift; cmd_start "$@" ;;
  wait) cmd_wait ;;
  disconnect) cmd_disconnect ;;
  *) say 'FAILED: Use start, wait or disconnect.' 1 ;;
esac
