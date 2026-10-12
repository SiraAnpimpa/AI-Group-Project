import { test, expect } from '@playwright/test';

test('empty state, responsive layout, settings and keyboard tabs',async({page})=>{
  await page.goto('/');await expect(page.locator('#analyze')).toBeDisabled();await expect(page.locator('#export-button')).toBeDisabled();
  await expect(page.locator('#height')).toHaveValue('');
  await page.locator('#advanced summary').click();await expect(page.locator('#excursion')).toBeVisible();
  await page.locator('#excursion').fill('25');await page.locator('#reset-settings').click();
  await expect(page.locator('#excursion')).toHaveValue('20');await expect(page.locator('#height')).toHaveValue('');
  await page.locator('#advanced summary').click();await page.locator('#tab-chart').focus();await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-lifts')).toBeFocused();await page.locator('#tab-chart').click();
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('manifest import reads synthetic subjects locally and preserves valid data on errors',async({page})=>{
  const external=[];page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4183/'))external.push(r.url());});
  await page.goto('/');
  const manifest=async text=>page.locator('#manifest-input').setInputFiles({name:'example.csv',mimeType:'text/csv',buffer:Buffer.from(text)});
  await manifest('\ufeffsubject_id,subject_height_cm\r\nexample-alpha,183\r\nexample-alpha,183\r\nexample-beta,162\r\n');
  await expect(page.locator('#status')).toContainText('นำเข้าส่วนสูงแล้ว');
  await expect(page.locator('#subject option')).toHaveCount(3);await page.locator('#subject').selectOption('example-alpha');
  await expect(page.locator('#height')).toHaveValue('183');await page.locator('#height').fill('181');
  await expect(page.locator('#subject')).toHaveValue('custom');
  await manifest('subject_id,subject_height_cm\nexample-conflict,180\nexample-conflict,181');
  await expect(page.locator('#error')).toContainText('ไม่ตรงกัน');await expect(page.locator('#subject option')).toHaveCount(3);
  await manifest('unrelated,columns\na,b');await expect(page.locator('#error')).toContainText('ไม่พบส่วนสูง');
  expect(external).toEqual([]);
});
