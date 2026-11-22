import { describe, expect, it } from 'vitest';
import { computeFolderId, computeRemoteId, folderSalt } from '../src/core/workspaceId';

const stat = { birthtimeMs: 1700000000000.7, ino: 12345 };

describe('workspace id rules (AC-1)', () => {
  it('macOS salts with the birthtime in ms (fixed expected md5)', () => {
    expect(computeFolderId('/home/u/shop-api', 'darwin', { birthtimeMs: 1700000000000, ino: 1 })).toBe(
      '6cdee044491f56194e3f6e33fc036bd1',
    );
  });

  it('Linux salts with the inode (fixed expected md5)', () => {
    expect(computeFolderId('/home/u/shop-api', 'linux', stat)).toBe('78b58bdae3a400a3eaff46027b1e0b88');
  });

  it('Windows salts with floor(birthtimeMs) (fixed expected md5)', () => {
    expect(computeFolderId('C:\\work\\shop-api', 'win32', { birthtimeMs: 1700000000123.9, ino: 0 })).toBe(
      'c74bfcb0a81b1d97d56c6628b27f779f',
    );
  });

  it('the same birthtime but a different path gives a different id (rename)', () => {
    const a = computeFolderId('/home/u/shop-api', 'darwin', { birthtimeMs: 1700000000000, ino: 1 });
    const b = computeFolderId('/home/u/shop-api-v2', 'darwin', { birthtimeMs: 1700000000000, ino: 1 });
    expect(b).toBe('15043dade54d230913204b386465d279');
    expect(b).not.toBe(a);
  });

  it('the same path with a new birthtime gives a different id (re-clone)', () => {
    const a = computeFolderId('/home/u/shop-api', 'darwin', { birthtimeMs: 1700000000000, ino: 1 });
    const b = computeFolderId('/home/u/shop-api', 'darwin', { birthtimeMs: 1700000009999, ino: 1 });
    expect(a).not.toBe(b);
  });

  it('each platform picks its own salt', () => {
    expect(folderSalt('darwin', stat)).toBe('1700000000000');
    expect(folderSalt('win32', stat)).toBe('1700000000000');
    expect(folderSalt('linux', stat)).toBe('12345');
    expect(folderSalt('linux', { birthtimeMs: 5, ino: 0 })).toBe('');
  });

  it('remote folders hash the URI string only', () => {
    expect(computeRemoteId('vscode-remote://ssh-remote%2Bdevbox/home/dev/shop-api')).toBe(
      '871d16e844617d7210c7cf3706269b5e',
    );
  });
});
