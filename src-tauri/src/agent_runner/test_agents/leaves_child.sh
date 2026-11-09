#!/bin/sh
# Starts a child that ignores SIGTERM, prints its pid, then waits for stdin to close.
sh -c "trap '' TERM; while true; do sleep 1; done" &
echo $!
cat >/dev/null
