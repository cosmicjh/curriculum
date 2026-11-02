export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const invalid = message => { throw new ApiError(400, 'VALIDATION', message); };
export const conflict = () => { throw new ApiError(409, 'CONFLICT', '다른 요청이 자료 또는 계획서를 변경했습니다. 작성 내용을 유지한 채 새로 불러와 확인해 주세요.'); };
export function business(fn) {
  try { return fn(); } catch (e) { if (e instanceof ApiError) throw e; invalid(e.message); }
}
