export async function clickMenu(page,button){
 await button.waitFor({state:'attached'});
 const opener=page.locator('[data-sidebar-open]');
 if(await opener.isVisible()&&await button.evaluate(el=>Boolean(el.closest('#sidebar')))&&await opener.getAttribute('aria-expanded')==='false')await opener.click();
 await button.click();
}
