#!/bin/sh
# Prints a short line, then a 100-character line, then waits.
echo short
printf '%0100d\n' 0
while true; do sleep 1; done
