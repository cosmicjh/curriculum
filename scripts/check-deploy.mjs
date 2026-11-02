import {readFile} from 'node:fs/promises';
const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const id=config.d1_databases?.find(d=>d.binding==='DB')?.database_id;
if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id||''))throw Error('Create the NEW school-timetable-db D1 database and insert its actual database_id into wrangler.jsonc before remote commands. Do not reuse the course-allocation database.');
if(config.name!=='school-timetable'||config.assets?.binding!=='ASSETS'||config.assets?.directory!=='./dist'||config.pages_build_output_dir)throw Error('Inconsistent Workers configuration');

const swap=config.d1_databases?.find(d=>d.binding==='CLASS_SWAP_DB');if(swap?.database_name!=='class-swap-db'||swap.database_id!=='d4e9d2e3-35cb-475f-b128-c78d714cd354'||swap.database_id===id)throw Error('Class-swap must use its existing, separate D1 database.');
