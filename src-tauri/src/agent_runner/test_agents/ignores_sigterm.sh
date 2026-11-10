#!/bin/sh
# Ignores stdin closing and SIGTERM; only SIGKILL ends it.
trap '' TERM
echo "holding on" >&2
while true; do sleep 1; done
