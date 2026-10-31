const { test } = require('node:test');
const assert = require('node:assert/strict');
const { updateProjectSchema, setOrganizationManagerSchema } = require('../src/schema/validation');

test('partial project updates preserve visibility unless explicitly supplied', () => {
  assert.deepEqual(updateProjectSchema.parse({ description: 'Updated description' }), { description: 'Updated description' });
  assert.equal(updateProjectSchema.parse({ visibility: 'public' }).visibility, 'public');
});

test('invalid manager roles retain actionable validation errors', () => {
  assert.equal(setOrganizationManagerSchema.safeParse({}).error.issues[0].message, 'setAsManager is required');
  assert.equal(setOrganizationManagerSchema.safeParse({setAsManager:'true'}).error.issues[0].message, 'setAsManager must be a boolean');
  assert.equal(setOrganizationManagerSchema.parse({setAsManager:false}).setAsManager, false);
});

test('updated PDF parser reads generated PDF bytes under the production Node runtime', async () => {
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText('Flowlio security regression', {font});
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({data:new Uint8Array(await pdf.save()), useSystemFonts:true});
  try {
    const document = await task.promise;
    const page = await document.getPage(1);
    const text = (await page.getTextContent()).items.map(item => item.str).join(' ');
    assert.match(text, /Flowlio security regression/);
  } finally { await task.destroy(); }
});
