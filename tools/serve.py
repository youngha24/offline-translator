# 시험용 정적 서버(표준 라이브러리) — python3 tools/serve.py <포트> [models 폴더]
import http.server, os, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
MODELS = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(ROOT, 'models')
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json'}
    def translate_path(self, path):
        p = path.split('?', 1)[0]
        if p.startswith('/models/'):
            return os.path.join(MODELS, p[len('/models/'):])
        return super().translate_path(path)
    def log_message(self, *a): pass
os.chdir(ROOT)
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
