#!/bin/sh
# Echoes each stdin line on stdout and notes it on stderr; exits 7 once stdin closes.
echo "agent starting" >&2
while IFS= read -r line; do
  printf '%s\n' "$line"
  printf 'got %s\n' "$line" >&2
done
echo "agent done" >&2
exit 7
