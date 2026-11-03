import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const config=JSON.parse(await readFile(new URL('wrangler.jsonc',root),'utf8'));
// This is only a local emulator storage identifier, never a remote D1 ID.
for(const binding of config.d1_databases)binding.database_id='local-timetable-emulator';
config.observability={enabled:false};
await writeFile(new URL('wrangler.local.json',root),JSON.stringify(config,null,2)+'\n');
