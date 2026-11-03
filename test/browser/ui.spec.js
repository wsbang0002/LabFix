import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{
 await page.route('**/api/analyze',async route=>{if(route.request().method()==='GET')await route.fulfill({json:{hasApiKey:false,isProductionReady:false}});else await route.fulfill({status:503,json:{success:false,error:'test failure'}});});
 page.on('dialog',d=>d.accept());await page.goto('/');
});
test('input, tab and example cancel pending requests and unlock buttons',async({page})=>{
 for(const action of ['input','tab','example']) {
  await page.evaluate(()=>switchTab('analyze'));
  await page.locator('#inp-log').fill('test log');
  await page.route('**/api/analyze',async route=>{if(route.request().method()==='POST'){await new Promise(r=>setTimeout(r,500));await route.fulfill({status:503,json:{success:false,error:'late'}}).catch(()=>{});}else await route.fallback();});
  await page.locator('#btn-analyze-ai').click();
  if(action==='input')await page.locator('#inp-log').fill('changed');
  if(action==='tab')await page.evaluate(()=>switchTab('history'));
  if(action==='example')await page.locator('#example-chips-container button').first().click();
  await expect(page.locator('#btn-analyze-ai')).toBeEnabled();
  await expect(page.locator('#btn-analyze-demo')).toHaveText('🔍 데모 분석 (오프라인)');
  await page.waitForTimeout(600);await expect(page.locator('#form-errors')).not.toContainText('late');
 }
});
test('demo cancellation resets its button; stale result cannot be saved',async({page})=>{
 await page.locator('#inp-log').fill('test');await page.locator('#btn-analyze-demo').click();await page.locator('#inp-log').fill('changed');
 await expect(page.locator('#btn-analyze-demo')).toHaveText('🔍 데모 분석 (오프라인)');
 await page.locator('#example-chips-container button').first().click();await page.locator('#inp-log').fill('new input');await expect(page.locator('#btn-save-record')).toBeDisabled();
});
test('history create/read/update/delete excludes raw log and code by default',async({page})=>{
 await page.locator('#example-chips-container button').first().click();
 await expect(page.locator('#res-include-raw')).not.toBeChecked();
 await page.locator('#btn-save-record').click();
 const records=await page.evaluate(()=>getHistoryFromStorage());expect(records).toHaveLength(1);expect(records[0].rawLog).toBe('');expect(records[0].rawCode).toBe('');
 await page.evaluate(id=>viewRecordDetail(id),records[0].id);
 await page.locator('#modal-edit-memo').fill('updated');
 await page.locator('#modal-edit-status').selectOption('solved');
 await page.getByRole('button',{name:'수정 사항 저장',exact:true}).click();
 const updated=await page.evaluate(()=>getHistoryFromStorage());expect(updated[0].resolutionMemo).toBe('updated');expect(updated[0].resolutionStatus).toBe('solved');
 await page.evaluate(id=>deleteRecord(id),records[0].id);expect(await page.evaluate(()=>getHistoryFromStorage())).toHaveLength(0);
});
test('API error never becomes a demo result',async({page})=>{
 await page.locator('#inp-log').fill('test');await page.locator('#btn-analyze-ai').click();await expect(page.locator('#form-errors')).toContainText('test failure');expect(await page.evaluate(()=>state.currentAnalysis)).toBeNull();
});
test('corrupt existing history is preserved; mobile viewport has no overflow',async({page})=>{
 await page.evaluate(()=>{localStorage.setItem(STORAGE_KEY,'corrupt-data');getHistoryFromStorage();});expect(await page.evaluate(()=>localStorage.getItem(STORAGE_KEY))).toBe('corrupt-data');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
