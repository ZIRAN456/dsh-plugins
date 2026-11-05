import { spawn } from 'node:child_process';

export const inject = ['connection'];

export function apply(ctx) {
  ctx.effect(() => {
    return ctx.connection.fetch.register({
      path: '/api/local/trigger-snipping',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async () => {
        if (process.platform !== 'win32') {
          return new Response(JSON.stringify({ ok: false, error: 'unsupported-platform' }), {
            status: 501,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Promise((resolve) => {
          let settled = false;
          let child;
          try {
            child = spawn('explorer.exe', ['ms-screenclip:'], {
              detached: true,
              stdio: 'ignore',
            });
          } catch (err) {
            return resolve(new Response(JSON.stringify({ ok: false, error: String(err) }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            }));
          }

          child.on('error', (err) => {
            console.error('[screenshot-button] spawn error:', err);
            if (!settled) {
              settled = true;
              resolve(new Response(JSON.stringify({ ok: false, error: String(err) }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
              }));
            }
          });

          child.on('spawn', () => {
            if (!settled) {
              settled = true;
              child.unref();
              resolve(new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }));
            }
          });

          setTimeout(() => {
            if (!settled) {
              settled = true;
              child.unref();
              resolve(new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }));
            }
          }, 150);
        });
      },
    });
  }, 'screenshot-button: trigger route');
}
