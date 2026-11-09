#!/bin/sh
# Writes to stderr and exits 3 at once.
echo "first problem" >&2
printf 'last problem' >&2
exit 3
