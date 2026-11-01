import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Keep existing bookmarks working. GitHub Pages serves no application or API.
export function destination(value){
  const source=new URL(value),name=source.pathname.split('/').filter(Boolean).at(-1)?.replace(/\.html$/,'');
  const page=['student','teacher','admin'].includes(name)?name+'.html':'';
  const target=new URL(page,'https://school-timetable.cosmicjh.workers.dev/');
  target.search=source.search;target.hash=source.hash;return target.href;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const output=resolve(import.meta.dirname,'../.cache/pages-redirect');
  await mkdir(output,{recursive:true});
  const html=`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<meta http-equiv="refresh" content="0;url=https://school-timetable.cosmicjh.workers.dev/">
<title>개인 시간표</title><script>location.replace((${destination.toString()})(location.href));</script></head>
<body><p>개인 시간표 주소가 변경되었습니다. <a href="https://school-timetable.cosmicjh.workers.dev/">개인 시간표로 이동</a></p></body></html>`;
  for(const file of ['index.html','student.html','teacher.html','admin.html','404.html'])await writeFile(resolve(output,file),html);
  await writeFile(resolve(output,'.nojekyll'),'');
  console.log('GitHub Pages compatibility redirects: .cache/pages-redirect/');
}
