import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {fastAuthorInstruction} from '../src/author-prompt.mjs';

test('recommended SVG text fallback inherits readable color while preserving explicit fills',async()=>{
  const rule=fastAuthorInstruction.match(/svg text:not\(\[fill\]\)\s*\{\s*fill:\s*currentColor;\s*\}/)?.[0];
  assert.ok(rule,'authoring instruction must give a safe SVG text fallback');
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();
    await page.setContent(`<style>body{background:#101827;color:#f8fafc}${rule}</style><svg><text id="default">Half</text><text id="explicit" fill="#22c55e">Quarter</text></svg>`);
    const fills=await page.evaluate(()=>['default','explicit'].map(id=>getComputedStyle(document.getElementById(id)).fill));
    assert.deepEqual(fills,['rgb(248, 250, 252)','rgb(34, 197, 94)']);
  } finally {await browser.close();}
});
