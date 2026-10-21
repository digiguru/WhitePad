import { describe, expect, it } from 'vitest';
import { classroomRequestError } from '../requestError';
describe('classroom API errors', () => {
  it('explains the persisted daily quota without encouraging immediate retries', () => {
    expect(classroomRequestError(429, { code: 'creation_quota' }).message).toContain('midnight UTC');
  });
  it('does not expose arbitrary response content', () => {
    expect(classroomRequestError(403, { error: 'sensitive response' }).message).toBe('Classroom request failed (403)');
    expect(classroomRequestError(429).message).toBe('Classroom request failed (429)');
  });
});
