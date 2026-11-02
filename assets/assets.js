(function(global){
  'use strict';
  const jobs=new Map(),base=document.currentScript&&document.currentScript.src?new URL('.',document.currentScript.src).href:'';
  const sources={xlsx:{file:'xlsx.full.min.js',global:'XLSX'},image:{file:'html2canvas.min.js',global:'html2canvas'}};
  function load(name){
    const asset=sources[name];if(!asset)return Promise.reject(Error('지원하지 않는 파일입니다.'));
    if(global[asset.global])return Promise.resolve(global[asset.global]);
    if(jobs.has(name))return jobs.get(name);
    const job=new Promise((resolve,reject)=>{const script=document.createElement('script');script.dataset.ttAsset=name;const timer=setTimeout(()=>fail(),30000);function fail(){clearTimeout(timer);jobs.delete(name);script.remove();reject(Error('처리 파일을 불러오지 못했습니다. 다시 시도하세요.'));}const url=new URL(asset.file,base);if(global.TIMETABLE_CONFIG?.assetVersion)url.searchParams.set('v',global.TIMETABLE_CONFIG.assetVersion);script.src=url.href;script.async=true;script.onload=()=>{clearTimeout(timer);if(global[asset.global]){script.dataset.loaded='true';resolve(global[asset.global]);}else fail();};script.onerror=fail;document.head.appendChild(script);});
    jobs.set(name,job);return job;
  }
  global.TTAssets={load};
})(window);
