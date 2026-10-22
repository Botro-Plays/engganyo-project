import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createProofAccessMiddleware } from '../../common/middleware/proof-access.middleware';
import { UploadsService } from './uploads.service';

/* ── A03: proof-download authorization middleware ─────────────────────── */

const SECRET = 'test-access-secret';

type VerifyResult = { sub: string; role: string; purpose: string };

function buildMiddleware(verifyImpl: (token: string) => VerifyResult, findUniqueImpl?: jest.Mock) {
  const jwtService = { verify: jest.fn(verifyImpl) } as any;
  const prisma = {
    taskCompletion: {
      findUnique: findUniqueImpl ?? jest.fn().mockResolvedValue(null),
    },
  } as any;
  const middleware = createProofAccessMiddleware(jwtService, prisma, SECRET);
  return { middleware, jwtService, prisma };
}

function fakeRes() {
  const res: any = {};
  res.status = jest.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return { json: jest.fn().mockImplementation((body: unknown) => { res.body = body; }) };
  });
  return res;
}

const VALID_PATH = '/owner-user/comp-1/file.webp';
const accessPayload = (over: Partial<VerifyResult> = {}): VerifyResult => ({
  sub: 'requester',
  role: 'USER',
  purpose: 'access',
  ...over,
});

describe('A03 — proof access middleware', () => {
  it('401s when the Authorization header is missing', async () => {
    const { middleware } = buildMiddleware(() => accessPayload());
    const res = fakeRes();
    const next = jest.fn();
    await middleware({ path: VALID_PATH, headers: {} }, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('401s on an arbitrary Bearer string (the old bypass)', async () => {
    const { middleware } = buildMiddleware(() => { throw new Error('invalid'); });
    const res = fakeRes();
    const next = jest.fn();
    await middleware(
      { path: VALID_PATH, headers: { authorization: 'Bearer anything' } },
      res,
      next,
    );
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('401s on a validly signed token with the wrong purpose', async () => {
    const { middleware } = buildMiddleware(() => accessPayload({ purpose: 'two_factor_auth' }));
    const res = fakeRes();
    const next = jest.fn();
    await middleware(
      { path: VALID_PATH, headers: { authorization: 'Bearer tok' } },
      res,
      next,
    );
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('403s on a malformed path (traversal segments)', async () => {
    const { middleware } = buildMiddleware(() => accessPayload({ sub: 'owner-user' }));
    const res = fakeRes();
    const next = jest.fn();
    await middleware(
      { path: '/../../secret.png', headers: { authorization: 'Bearer tok' } },
      res,
      next,
    );
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows the proof owner', async () => {
    const { middleware } = buildMiddleware(() => accessPayload({ sub: 'owner-user' }));
    const res = fakeRes();
    const next = jest.fn();
    await middleware(
      { path: VALID_PATH, headers: { authorization: 'Bearer tok' } },
      res,
      next,
    );
    expect(next).toHaveBeenCalled();
  });

  it('allows admin roles', async () => {
    for (const role of ['ADMIN', 'MODERATOR', 'SUPER_ADMIN']) {
      const { middleware } = buildMiddleware(() => accessPayload({ role }));
      const res = fakeRes();
      const next = jest.fn();
      await middleware(
        { path: VALID_PATH, headers: { authorization: 'Bearer tok' } },
        res,
        next,
      );
      expect(next).toHaveBeenCalled();
    }
  });

  it('allows the campaign reviewer (owner of the campaign the completion belongs to)', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      userId: 'owner-user',
      campaign: { userId: 'requester' },
    });
    const { middleware } = buildMiddleware(() => accessPayload(), findUnique);
    const res = fakeRes();
    const next = jest.fn();
    await middleware(
      { path: VALID_PATH, headers: { authorization: 'Bearer tok' } },
      res,
      next,
    );
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'comp-1' } }),
    );
    expect(next).toHaveBeenCalled();
  });

  it('403s an unrelated user even when a completion exists', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      userId: 'owner-user',
      campaign: { userId: 'someone-else' },
    });
    const { middleware } = buildMiddleware(() => accessPayload(), findUnique);
    const res = fakeRes();
    const next = jest.fn();
    await middleware(
      { path: VALID_PATH, headers: { authorization: 'Bearer tok' } },
      res,
      next,
    );
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});

/* ── A04: upload path safety, ownership, and content validation ───────── */

describe('A04 — uploads service', () => {
  const prisma = {
    taskCompletion: { findUnique: jest.fn() },
  };
  let service: UploadsService;
  const createdDirs: string[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UploadsService(prisma as any);
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
      expect(prisma.taskCompletion.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a completion id that does not exist', async () => {
      prisma.taskCompletion.findUnique.mockResolvedValue(null);
      await expect(service.prepareProofStorage('user1', 'comp123')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects a completion owned by a different user', async () => {
      prisma.taskCompletion.findUnique.mockResolvedValue({ userId: 'other' });
      await expect(service.prepareProofStorage('user1', 'comp123')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns a contained, server-derived path for the assigned user', async () => {
      prisma.taskCompletion.findUnique.mockResolvedValue({ userId: 'user1' });
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
