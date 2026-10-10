#!/bin/sh
# Ignores SIGTERM; only SIGKILL ends it.
trap '' TERM
while true; do sleep 1; done
