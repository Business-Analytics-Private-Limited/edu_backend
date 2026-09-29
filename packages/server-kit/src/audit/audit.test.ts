import { describe, expect, it } from 'vitest';
import { diffForAudit } from './audit';

describe('diffForAudit', () => {
  it('records every field of a created entity', () => {
    expect(diffForAudit(null, { fullName: 'Ravi', status: 'active' })).toEqual({
      fullName: [null, 'Ravi'],
      status: [null, 'active'],
    });
  });

  it('records only changed fields of an update', () => {
    expect(
      diffForAudit(
        { fullName: 'Ravi', status: 'active' },
        { fullName: 'Ravi K', status: 'active' },
      ),
    ).toEqual({ fullName: ['Ravi', 'Ravi K'] });
  });

  it('compares nested values by content', () => {
    const address = { city: 'Hyderabad' };
    expect(diffForAudit({ address }, { address: { city: 'Hyderabad' } })).toEqual({});
  });

  it('never records secret values', () => {
    expect(diffForAudit({ passwordHash: 'a' }, { passwordHash: 'b' })).toEqual({
      passwordHash: ['[redacted]', '[redacted]'],
    });
    expect(diffForAudit(null, { deviceSecret: 'x' })).toEqual({
      deviceSecret: ['[redacted]', '[redacted]'],
    });
  });

  it('ignores bookkeeping fields', () => {
    expect(diffForAudit({ version: 1, updatedAt: 'a' }, { version: 2, updatedAt: 'b' })).toEqual(
      {},
    );
  });
});
