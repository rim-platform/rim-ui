#!/usr/bin/env python3
"""A RIM backup endpoint (backup-endpoint-v1.md) that keeps the files under one directory.

    python3 backup-endpoint-reference.py --dir DIR [--host 127.0.0.1] [--port 8787]
        [--basic USER:PASSWORD | --bearer TOKEN | --header NAME:TOKEN]

Plain HTTP only: put a TLS-terminating proxy in front of it to reach it from another computer.
"""
import argparse, base64, hmac, json, os, tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

MAX_BODY = 64 * 1024 * 1024

def serve(args):
    root = os.path.realpath(args.dir)
    want = None
    if args.basic: want = ("Authorization", "Basic " + base64.b64encode(args.basic.encode()).decode())
    if args.bearer: want = ("Authorization", "Bearer " + args.bearer)
    if args.header: want = tuple(args.header.split(":", 1))

    class Handler(BaseHTTPRequestHandler):
        def answer(self, status, body=b"", kind="application/octet-stream"):
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def target(self):
            url = urlsplit(self.path)
            if url.path.rstrip("/") != "/backup": return self.answer(404)
            if want and not hmac.compare_digest(self.headers.get(want[0], "").encode(), want[1].encode()):
                return self.answer(401)
            query = parse_qs(url.query, keep_blank_values=True)
            for key in ("path", "list"):
                if key in query:
                    parts = query[key][0].split("/") if query[key][0] else []
                    if any(p in ("", ".", "..") or "\\" in p or "\0" in p for p in parts): return self.answer(400)
                    return key, os.path.join(root, *parts)
            self.answer(400)

        def do_GET(self):
            key, path = self.target() or (None, None)
            if key == "list" and os.path.isdir(path):
                entries = sorted(({"name": e.name, "dir": e.is_dir()} for e in os.scandir(path)), key=lambda e: e["name"])
                self.answer(200, json.dumps(entries).encode(), "application/json")
            elif key == "path" and os.path.isfile(path):
                with open(path, "rb") as f: self.answer(200, f.read())
            elif key: self.answer(404)

        def do_POST(self):
            key, path = self.target() or (None, None)
            if key != "path" or path == root: return key and self.answer(400)
            length = int(self.headers.get("Content-Length", "0"))
            if length > MAX_BODY: return self.answer(413)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            fd, temp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".upload-")
            with os.fdopen(fd, "wb") as f: f.write(self.rfile.read(length))
            existed = os.path.exists(path)
            try:  # A hard link fails when the name is taken: the exclusive create.
                os.link(temp, path) if self.headers.get("If-None-Match") == "*" else os.replace(temp, path)
            except FileExistsError: return self.answer(412)
            finally:
                if os.path.exists(temp): os.unlink(temp)
            self.answer(204 if existed else 201)

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"listening on http://{args.host}:{server.server_address[1]}/backup", flush=True)
    server.serve_forever()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dir", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    auth = parser.add_mutually_exclusive_group()
    for flag in ("--basic", "--bearer", "--header"): auth.add_argument(flag)
    serve(parser.parse_args())
