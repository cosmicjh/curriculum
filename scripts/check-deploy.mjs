import {readFile} from 'node:fs/promises';
const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const id=config.d1_databases?.find(d=>d.binding==='DB')?.database_id;
if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id||''))throw Error('Create the NEW school-timetable-db D1 database and insert its actual database_id into wrangler.jsonc before remote commands. Do not reuse the course-allocation database.');
if(config.name!=='school-timetable'||config.assets?.binding!=='ASSETS'||config.assets?.directory!=='./dist'||config.pages_build_output_dir)throw Error('Inconsistent Workers configuration');

const course=config.d1_databases.find(d=>d.binding==='COURSE_DB');
if(config.d1_databases.length!==2||course?.database_id!=='2f1b7cde-5ea8-453b-b810-f372cf138c60'||course.database_id===id)
 throw Error('Use the existing course allocation D1 database for COURSE_DB.');
