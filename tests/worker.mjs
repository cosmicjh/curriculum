// Only this test worker exposes SQL. This file is never a deployment entry point.
import worker from '../src/worker.js';
export default {async fetch(request,env){if(new URL(request.url).pathname==='/__fixture_sql'){const {sql,args=[],binding="DB"}=await request.json();return Response.json(await env[binding].prepare(sql).bind(...args).all());}return worker.fetch(request,env);}};
