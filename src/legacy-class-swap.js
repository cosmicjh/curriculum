const destination='https://cosmicjh.github.io/timetable/#/teacher';
export default {fetch(request){
 const headers={'Cache-Control':'no-store'};
 if(['GET','HEAD'].includes(request.method))return new Response(null,{status:302,headers:{...headers,Location:destination}});
 return Response.json({ok:false,code:'MOVED',message:'결보강은 개인시간표에 통합되었습니다. cosmicjh.github.io/timetable에서 이용해 주세요.'},{status:410,headers});
}};
