#!/bin/sh
# Exits 3 once stdin closes; a signal would end it with no exit code.
cat >/dev/null
exit 3
