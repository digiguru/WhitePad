/** Only expose a known, actionable server error; never display arbitrary response bodies. */
export function classroomRequestError(status: number, payload?: unknown): Error {
  if (status === 429 && typeof payload === 'object' && payload !== null && 'code' in payload && payload.code === 'creation_quota')
    return new Error('The daily room-creation limit has been reached. It resets at midnight UTC. Existing rooms are still available.');
  return new Error(`Classroom request failed (${status})`);
}
