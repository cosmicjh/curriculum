// One explicitly configured Pages origin. No wildcard or reflected CORS origins.
export function pagesRequest(request,env){
  const origin=request.headers.get('Origin');
  return Boolean(env.FRONTEND_ORIGIN&&origin===env.FRONTEND_ORIGIN&&origin!==new URL(request.url).origin);
}
export function allowedRequest(request,env){
  const own=request.headers.get('Origin')===new URL(request.url).origin;
  return pagesRequest(request,env)||(own&&request.headers.get('Sec-Fetch-Site')!=='cross-site');
}
export function cors(request,env,headers){
  headers.set('Vary','Origin');
  if(pagesRequest(request,env)){
    headers.set('Access-Control-Allow-Origin',env.FRONTEND_ORIGIN);
    headers.set('Access-Control-Expose-Headers','Server-Timing, X-D1-Rows-Read, X-D1-Rows-Written');
  }
}
