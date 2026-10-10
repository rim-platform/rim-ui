#!/bin/sh
# Runs until SIGTERM, then exits 0.
trap 'exit 0' TERM
while true; do sleep 1; done
