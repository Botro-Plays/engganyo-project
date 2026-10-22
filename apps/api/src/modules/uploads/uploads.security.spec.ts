import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import express from 'express';
import sharp from 'sharp';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createProofAccessHandler } from '../../common/middleware/proof-access.middleware';
import { UploadsService } from './uploads.service';

/* ── A03: mounted HTTP/static-stack integration tests ───────────────────
   A real Express app replicating the production mounts:
     app.use('/uploads/proofs', createProofAccessHandler(...))
     app.use('/uploads/avatars', express.static(<avatars root>))
   Requests go over a real socket with real JWT signing/verification.
   ─────────────────────────────────────────────────────────────────────── */

const SECRET = 'integration-access-secret';

const prisma = {
  user: { findUnique: jest.fn() },
  taskCompletion: { findUnique: jest.fn() },
};

const jwtService = new JwtService();
const sign = (payload: object, opts: object = {}) =>
  jwtService.sign(payload, { secret: SECRET, ...opts });

const accessToken = (over: object = {}) =>
  sign({ sub: 'requester', role: 'USER', purpose: 'access', ...over });

const dbUser = (over: object = {}) => ({
  role: 'USER',
  status: 'ACTIVE',
  ...over,
});

describe('A03 — mounted proof-access stack', () => {
  let server: http.Server;
  let base: string;
  let uploadsRoot: string;

  beforeAll(async () => {
    uploadsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-stack-'));
    fs.mkdirSync(path.join(uploadsRoot, 'avatars'), { recursive: true });
    fs.mkdirSync(path.join(uploadsRoot, 'proofs', 'owner-user', 'comp-1'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(uploadsRoot, 'proofs', 'owner-user', 'comp-1', 'secret.webp'),
      'PROOF-BYTES',
    );
    fs.writeFileSync(path.join(uploadsRoot, 'avatars', 'pub.webp'), 'AVATAR');

    const app = express();
    app.use(
      '/uploads/proofs',
      createProofAccessHandler(
        jwtService,
        prisma as any,
        SECRET,
        path.join(uploadsRoot, 'proofs'),
      ),
    );
    app.use(
      '/uploads/avatars',
      express.static(path.join(uploadsRoot, 'avatars')),
    );

    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const { port } = server.address() as { port: number };
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          try {
            fs.rmSync(uploadsRoot, { recursive: true, force: true });
          } catch {
            /* best effort */
          }
          resolve();
        });
      }),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue(dbUser());
    prisma.taskCompletion.findUnique.mockResolvedValue(null);
  });

  const get = (urlPath: string, token?: string) =>
    fetch(`${base}${urlPath}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

  it('serves public avatars without authentication', async () => {
    const res = await get('/uploads/avatars/pub.webp');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('AVATAR');
  });

  it('401s proof requests with no Authorization header', async () => {
    const res = await get('/uploads/proofs/owner-user/comp-1/secret.webp');
    expect(res.status).toBe(401);
  });

  it('401s an arbitrary Bearer string (the original bypass)', async () => {
    const res = await get(
      '/uploads/proofs/owner-user/comp-1/secret.webp',
      'anything',
    );
    expect(res.status).toBe(401);
  });

  it('does not serve proofs through the encoded-path bypass (%70roofs)', async () => {
    const encoded = '/uploads/%70roofs/owner-user/comp-1/secret.webp';
    const anon = await get(encoded);
    const authed = await get(encoded, accessToken({ sub: 'owner-user' }));
    expect([404, 401, 403]).toContain(anon.status);
    expect([404, 401, 403]).toContain(authed.status);
    expect(anon.status).not.toBe(200);
    expect(authed.status).not.toBe(200);
  });

  it('does not serve proofs through mixed-case or encoded-separator variants', async () => {
    for (const p of [
      '/uploads/proofs%2fowner-user/comp-1/secret.webp',
      '/uploads/%70%72%6f%6f%66%73/owner-user/comp-1/secret.webp',
      '/uploads/proofs/owner-user/comp-1/%2e%2e/secret.webp',
    ]) {
      const res = await get(p, accessToken({ sub: 'owner-user' }));
      expect(res.status).not.toBe(200);
    }
  });

  it('401s an expired access token', async () => {
    const res = await get(
      '/uploads/proofs/owner-user/comp-1/secret.webp',
      sign(
        { sub: 'owner-user', role: 'USER', purpose: 'access' },
        { expiresIn: -10 },
      ),
    );
    expect(res.status).toBe(401);
  });

  it('401s a validly signed wrong-purpose token', async () => {
    const res = await get(
      '/uploads/proofs/owner-user/comp-1/secret.webp',
      accessToken({ purpose: 'two_factor_auth', sub: 'owner-user' }),
    );
    expect(res.status).toBe(401);
  });

  it('401s a token signed with the wrong secret', async () => {
    const res = await get(
      '/uploads/proofs/owner-user/comp-1/secret.webp',
      jwtService.sign(
        { sub: 'owner-user', purpose: 'access' },
        { secret: 'wrong' },
      ),
    );
    expect(res.status).toBe(401);
  });

  it('401s when the token subject no longer exists in the database', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = await get(
      '/uploads/proofs/owner-user/comp-1/secret.webp',
      accessToken({ sub: 'owner-user' }),
    );
    expect(res.status).toBe(401);
  });

  it.each(['SUSPENDED', 'BANNED', 'DEACTIVATED'])(
    '401s a %s account even with a valid token',
    async (status) => {
      prisma.user.findUnique.mockResolvedValue(dbUser({ status }));
      const res = await get(
        '/uploads/proofs/owner-user/comp-1/secret.webp',
        accessToken({ sub: 'owner-user' }),
      );
      expect(res.status).toBe(401);
    },
  );

  it('does not honor a stale JWT admin role — role comes from the database', async () => {
    // Token claims ADMIN but the user was demoted to USER in the database.
    prisma.user.findUnique.mockResolvedValue(dbUser({ role: 'USER' }));
    const res = await get(
      '/uploads/proofs/owner-user/comp-1/secret.webp',
      accessToken({ sub: 'requester', role: 'ADMIN' }),
    );
    expect(res.status).toBe(403);
  });

  it('serves the proof to its owner with private no-store caching', async () => {
    const res = await get(
      '/uploads/proofs/owner-user/comp-1/secret.webp',
      accessToken({ sub: 'owner-user' }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('PROOF-BYTES');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('serves the proof to a current-database admin', async () => {
    prisma.user.findUnique.mockResolvedValue(dbUser({ role: 'SUPER_ADMIN' }));
    const res = await get(
      '/uploads/proofs/owner-user/comp-1/secret.webp',
      accessToken({ sub: 'admin-user' }),
    );
    expect(res.status).toBe(200);
  });

  it('serves the proof to the campaign reviewer', async () => {
    prisma.taskCompletion.findUnique.mockResolvedValue({
      userId: 'owner-user',
      campaign: { userId: 'requester' },
    });
    const res = await get(
      '/uploads/proofs/owner-user/comp-1/secret.webp',
      accessToken(),
    );
    expect(res.status).toBe(200);
    expect(prisma.taskCompletion.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'comp-1' } }),
    );
  });

  it('403s an unrelated active user', async () => {
    prisma.taskCompletion.findUnique.mockResolvedValue({
      userId: 'owner-user',
      campaign: { userId: 'someone-else' },
    });
    const res = await get(
      '/uploads/proofs/owner-user/comp-1/secret.webp',
      accessToken(),
    );
    expect(res.status).toBe(403);
  });

  it('never serves proof bytes through literal or encoded traversal', async () => {
    // Browsers/HTTP clients normalize literal '..' and '%2e%2e' before the
    // request reaches Express — the only 200s possible are the public avatar.
    // Any encoded/delimiter variant that reaches the proofs mount contains
    // characters outside the safe-segment charset and is rejected.
    for (const p of [
      '/uploads/proofs/owner-user/../../avatars/pub.webp',
      '/uploads/proofs/owner-user/%2e%2e/%2e%2e/avatars/pub.webp',
      '/uploads/proofs/owner-user/comp-1/%2e%2e/secret.webp',
      '/uploads/proofs/owner-user/comp-1/..%2f..%2favatars%2fpub.webp',
    ]) {
      const res = await get(p, accessToken({ sub: 'owner-user' }));
      if (res.status === 200) {
        expect(await res.text()).toBe('AVATAR');
      } else {
        expect([401, 403, 404]).toContain(res.status);
      }
    }
  });

  it('404s an authorized request for a missing file', async () => {
    const res = await get(
      '/uploads/proofs/owner-user/comp-1/missing.webp',
      accessToken({ sub: 'owner-user' }),
    );
    expect(res.status).toBe(404);
  });
});

/* ── A04: upload path safety, ownership, and content validation ───────── */

describe('A04 — uploads service', () => {
  const prismaA04 = {
    taskCompletion: { findUnique: jest.fn() },
  };
  let service: UploadsService;
  const createdDirs: string[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UploadsService(prismaA04 as any);
  });

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('prepareProofStorage', () => {
    it('rejects traversal taskIds before touching the filesystem', async () => {
      for (const bad of ['../../x', 'a/b', 'a\\b', '..', 'a.b', '', '   ']) {
        await expect(service.prepareProofStorage('user1', bad)).rejects.toThrow(
          BadRequestException,
        );
      }
      expect(prismaA04.taskCompletion.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a completion id that does not exist', async () => {
      prismaA04.taskCompletion.findUnique.mockResolvedValue(null);
      await expect(service.prepareProofStorage('user1', 'comp123')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects a completion owned by a different user', async () => {
      prismaA04.taskCompletion.findUnique.mockResolvedValue({ userId: 'other' });
      await expect(service.prepareProofStorage('user1', 'comp123')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns a contained, server-derived path for the assigned user', async () => {
      prismaA04.taskCompletion.findUnique.mockResolvedValue({ userId: 'user1' });
      const { relativeUrl, destPath } = await service.prepareProofStorage('user1', 'comp123');
      createdDirs.push(path.dirname(destPath));

      expect(relativeUrl).toMatch(/^\/uploads\/proofs\/user1\/comp123\/[0-9a-f-]+\.webp$/);
      expect(destPath.endsWith('.webp')).toBe(true);
      const contained = path.resolve(process.cwd(), 'uploads', 'proofs') + path.sep;
      expect(path.resolve(destPath).startsWith(contained)).toBe(true);
    });
  });

  describe('resolveContainedPath', () => {
    it('rejects escapes from the base directory', () => {
      const base = path.join(os.tmpdir(), 'proofs-base');
      expect(() => service.resolveContainedPath(base, '..', 'evil.png')).toThrow(
        ForbiddenException,
      );
      expect(() => service.resolveContainedPath(base, 'a', '..', '..', 'evil.png')).toThrow(
        ForbiddenException,
      );
      expect(() => service.resolveContainedPath(base, 'a', 'ok.png')).not.toThrow();
    });
  });

  describe('reencodeToWebp', () => {
    let tmp: string;
    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-spec-'));
    });
    afterEach(() => {
      // sharp can briefly hold output handles on Windows — cleanup is best
      // effort so a lingering lock never fails the suite (CI runs Linux).
      try {
        for (const f of fs.readdirSync(tmp)) {
          fs.rmSync(path.join(tmp, f), { force: true, maxRetries: 10, retryDelay: 200 });
        }
        fs.rmdirSync(tmp);
      } catch {
        /* leave the tmp dir; os temp is ephemeral */
      }
    });

    it('re-encodes a real image to webp regardless of claimed type', async () => {
      const png = await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#3366ff' },
      }).png().toBuffer();
      const dest = path.join(tmp, 'out.webp');
      await service.reencodeToWebp(png, dest);
      const meta = await sharp(dest).metadata();
      expect(meta.format).toBe('webp');
    });

    it('rejects non-image bytes claiming an image MIME type', async () => {
      const fake = Buffer.from('MZ\x90\x00 not an image but says image/png');
      await expect(
        service.reencodeToWebp(fake, path.join(tmp, 'out.webp')),
      ).rejects.toThrow(BadRequestException);
      expect(fs.existsSync(path.join(tmp, 'out.webp'))).toBe(false);
    });

    it('rejects an HTML/JS payload masquerading as an image', async () => {
      const payload = Buffer.from('<html><script>alert(1)</script></html>');
      await expect(
        service.reencodeToWebp(payload, path.join(tmp, 'x.webp')),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
