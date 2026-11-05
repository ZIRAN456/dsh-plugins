import { spawn } from 'node:child_process';

export const inject = ['webServer'];

export function apply(ctx) {
  ctx.effect(() => {
    return ctx.webServer.register({
      kind: 'exact',
      path: '/api/local/trigger-snipping',
      handler(req, res) {
        if (req.method === 'POST') {
          try {
            const child = spawn('explorer.exe', ['ms-screenclip:'], {
              detached: true,
              stdio: 'ignore',
            });
            child.unref();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        } else {
          res.writeHead(405);
          res.end();
        }
      },
    });
  });
}
