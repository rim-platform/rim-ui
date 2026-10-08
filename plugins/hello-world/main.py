#!/usr/bin/env python3
"""
Hello World plugin — reference implementation of RIM plugin protocol v1.

The protocol is frozen in protocol/plugin-protocol-v1.schema.json at the root of
rim-ui; the host's conformance tests drive this script through it.

  - Frame: [4-byte little-endian length][UTF-8 JSON], one JSON-RPC 2.0 message.
  - The host writes to our stdin and reads our stdout.
  - Field names in params and results are camelCase.

What happens:
  1. The host sends `rim.handshake`; we accept if it speaks protocol v1.
  2. The host sends `rim.heartbeat` every 30 s; we answer `{"pong": true}`.
  3. Running the `greet` command sends `rim.command.execute` with
     `{"commandId": "greet", "args": {"name": ...}, ...}`; we answer
     `{"payload": "Hello, <name>!"}`.
  4. `rim.shutdown`, or our stdin closing, makes us exit.

Requests we do not know get METHOD_NOT_FOUND; notifications we do not know
(such as `rim.principal.changed`, which we do not use) are ignored.
"""

import json
import os
import struct
import sys

PLUGIN_ID = "dev.example.hello-world"
PROTOCOL_VERSION = 1

METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602


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
    params = request.get("params") or {}
    plugin_id = params.get("pluginId", "")
    supported = params.get("supportedVersions") or []

    def refuse(reason: str) -> dict:
        return make_response(request["id"], result={
            "accepted": False,
            "protocolVersion": PROTOCOL_VERSION,
            "pluginId": PLUGIN_ID,
            "error": reason,
        })

    if plugin_id != PLUGIN_ID:
        return refuse(f"pluginId mismatch: expected {PLUGIN_ID}, got {plugin_id}")
    if PROTOCOL_VERSION not in supported:
        return refuse(f"host speaks protocol {supported}, this plugin speaks {PROTOCOL_VERSION}")

    return make_response(request["id"], result={
        "accepted": True,
        "protocolVersion": PROTOCOL_VERSION,
        "pluginId": PLUGIN_ID,
    })


def handle_execute(request: dict) -> dict:
    params = request.get("params") or {}
    command_id = params.get("commandId")
    args = params.get("args") or {}
    if command_id == "greet":
        name = args.get("name") or "world"
        return make_response(request["id"], result={"payload": f"Hello, {name}!"})
    return make_response(request["id"], error={
        "code": INVALID_PARAMS,
        "message": f"unknown command: {command_id}",
    })


def main() -> None:
    send_log("info", f"[hello-world] plugin process started (pid={os.getpid()})")

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
            write_frame(handle_handshake(request))
            send_log("info", "[hello-world] handshake complete — broker loop active")

        elif method == "rim.heartbeat":
            write_frame(make_response(req_id, result={"pong": True}))

        elif method == "rim.command.execute":
            write_frame(handle_execute(request))

        elif method == "rim.shutdown":
            break

        elif req_id is not None:
            write_frame(make_response(req_id, error={
                "code": METHOD_NOT_FOUND,
                "message": f"method not found: {method}",
            }))
        # Other notifications are ignored.


if __name__ == "__main__":
    main()
