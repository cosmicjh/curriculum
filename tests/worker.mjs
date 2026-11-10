// Only this test worker exposes SQL. This file is never a deployment entry point.
import worker from '../src/worker.js';
export default {scheduled:worker.scheduled,async fetch(request,env){if(new URL(request.url).pathname==='/__fixture_sql'){const {sql,args=[],binding}=await request.json();return Response.json(await env[binding==='COURSE_DB'?'COURSE_DB':'DB'].prepare(sql).bind(...args).all());}return worker.fetch(request,env);}};
