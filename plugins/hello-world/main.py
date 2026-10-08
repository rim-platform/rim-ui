#!/usr/bin/env python3
"""
Hello World plugin — reference implementation for the RIM plugin host.

This script speaks the RIM wire protocol: 4-byte little-endian length-prefixed
JSON-RPC 2.0 frames over stdin/stdout.

Observable side-effect:
  1. The host sends `rim.handshake` → plugin replies with `accepted: true`.
  2. The broker loop starts; heartbeats are exchanged every 30 s.
  3. When the plugin sends `rim.log`, the host prints it to its log.
  4. Running the `greet` command sends `rim.command.execute` with
     `{"command_id": "greet", "args": {"name": ...}}`; the plugin answers with
     `"Hello, <name>!"`.

Wire protocol:
  - Frame: [4-byte little-endian length][UTF-8 JSON]
  - All messages are JSON-RPC 2.0 objects.
  - The plugin reads host requests from stdin and writes responses to stdout.
    Frames without a `method` are the host's responses to the plugin's own
    requests and are ignored here.
"""

import json
import struct
import sys
import threading

PLUGIN_ID = "dev.example.hello-world"
PROTOCOL_VERSION = 1


def read_frame() -> dict:
    """Read one length-prefixed JSON-RPC frame from stdin."""
    header = sys.stdin.buffer.read(4)
    if len(header) < 4:
        raise EOFError("stdin closed")
    (length,) = struct.unpack("<I", header)
    body = sys.stdin.buffer.read(length)
    if len(body) < length:
        raise EOFError("truncated frame")
    return json.loads(body.decode("utf-8"))


def write_frame(obj: dict) -> None:
    """Write one length-prefixed JSON-RPC frame to stdout."""
    body = json.dumps(obj).encode("utf-8")
    header = struct.pack("<I", len(body))
    sys.stdout.buffer.write(header + body)
    sys.stdout.buffer.flush()


def make_response(request_id, result=None, error=None) -> dict:
    resp = {"jsonrpc": "2.0", "id": request_id}
    if error is not None:
        resp["error"] = error
    else:
        resp["result"] = result
    return resp


def send_log(level: str, message: str) -> None:
    """Send a rim.log notification to the host (always allowed, no capability needed)."""
    write_frame({
        "jsonrpc": "2.0",
        "method": "rim.log",
        "params": {"level": level, "message": message},
    })


def handle_handshake(request: dict) -> dict:
    params = request.get("params", {})
    plugin_id = params.get("plugin_id", "")
    protocol_version = params.get("protocol_version", 0)

    if plugin_id != PLUGIN_ID:
        return make_response(request["id"], result={
            "accepted": False,
            "protocol_version": PROTOCOL_VERSION,
            "plugin_id": PLUGIN_ID,
            "error": f"plugin_id mismatch: expected {PLUGIN_ID}, got {plugin_id}",
        })

    return make_response(request["id"], result={
        "accepted": True,
        "protocol_version": protocol_version,
        "plugin_id": PLUGIN_ID,
        "error": None,
    })


def handle_heartbeat(request: dict) -> dict:
    return make_response(request["id"], result={"pong": True})


def handle_execute(request: dict) -> dict:
    params = request.get("params") or {}
    command_id = params.get("command_id")
    args = params.get("args") or {}
    if command_id == "greet":
        name = args.get("name") or "world"
        return make_response(request["id"], result=f"Hello, {name}!")
    return make_response(request["id"], error={
        "code": -32601,
        "message": f"unknown command: {command_id}",
    })


def main() -> None:
    send_log("info", f"[hello-world] plugin process started (pid={__import__('os').getpid()})")

    while True:
        try:
            request = read_frame()
        except EOFError:
            # Host closed stdin — time to exit.
            break

        method = request.get("method")
        req_id = request.get("id")

        if method is None:
            # A response to one of our own requests — nothing to do.
            continue

        if method == "rim.handshake":
            response = handle_handshake(request)
            write_frame(response)
            send_log("info", "[hello-world] handshake complete — broker loop active")

        elif method == "rim.heartbeat":
            write_frame(make_response(req_id, result={"pong": True}))

        elif method == "rim.command.execute":
            write_frame(handle_execute(request))

        elif req_id is not None:
            # Unknown method — return method-not-found error
            write_frame(make_response(req_id, error={
                "code": -32601,
                "message": f"method not found: {method}",
            }))
        # Notifications (no id) are silently dropped.


if __name__ == "__main__":
    main()
