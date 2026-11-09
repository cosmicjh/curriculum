// Deploy only to a separate test project until the operating cutover is approved.
// Update the existing deployment's VERSION at cutover; never replace its ID.
function doGet(e) {
  var seat = e && e.parameter ? e.parameter.seat : '';
  var target = PropertiesService.getScriptProperties().getProperty('STUDYROOM_TARGET_URL') || '';
  if (!/^(0[1-9]|[1-9][0-9])$/.test(seat) ||
      !/^https:\/\/[a-z0-9.-]+\/(?:[A-Za-z0-9_-]+\/)*studyroom-student\.html$/.test(target)) {
    return HtmlService.createHtmlOutput('<html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><p>좌석 QR 또는 연결 설정을 확인해 주세요.</p></html>');
  }
  var href = (target + '?seat=' + seat).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return HtmlService.createHtmlOutput('<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>스터디룸 출석</title>' +
    '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard-dynamic-subset.min.css">' +
    '<style>body{margin:0;background:#fff;color:#222;font:16px/1.6 Pretendard,system-ui,sans-serif}main{max-width:420px;margin:12vh auto;padding:24px}h1{font-size:26px;letter-spacing:-.03em}a{display:block;background:#222;color:#fff;text-align:center;text-decoration:none;border-radius:8px;padding:14px;margin-top:28px}a:focus-visible{outline:3px solid #555;outline-offset:4px}</style></head>' +
    '<body><main><h1>스터디룸 출석</h1><p>' + seat + '번 좌석</p><a target="_blank" rel="noopener noreferrer" href="' + href + '">출석 화면 열기</a></main></body></html>');
}
