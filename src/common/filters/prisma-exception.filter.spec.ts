import { duplicateMessage } from './prisma-exception.filter';

describe('duplicateMessage', () => {
  it('names the columns when Prisma gives them, without the ids they belong to', () => {
    expect(duplicateMessage({ target: ['email'] })).toBe('This email is already used');
    expect(duplicateMessage({ target: ['organization_id', 'code'] })).toBe(
      'This code is already used',
    );
  });

  it('says what is taken from the model when row security hides the columns', () => {
    expect(duplicateMessage({ modelName: 'DocumentType', target: null })).toBe(
      'A document type with this name already exists',
    );
    expect(duplicateMessage({ modelName: 'Role', target: null })).toBe(
      'A role with this name already exists',
    );
  });

  it('ignores an index name and falls back to a general message', () => {
    expect(duplicateMessage({ modelName: 'Unknown', target: 'some_index_key' })).toBe(
      'This value is already used',
    );
    expect(duplicateMessage(undefined)).toBe('This value is already used');
  });
});
