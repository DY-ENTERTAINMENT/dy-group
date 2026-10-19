import assert from 'node:assert/strict';
import { validateDesignerReferenceFile, validateReferenceItemSelection } from '../src/services/designer-reference-files.ts';

const imageLimit = 10 * 1024 * 1024;
const pdfLimit = 30 * 1024 * 1024;
const allowed = { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'], 'application/pdf': ['pdf'] };
function assertReject(file) { assert.throws(() => validateDesignerReferenceFile(file)); }

for (const [type, ext] of Object.entries(allowed)) validateDesignerReferenceFile({ name: `reference.${ext[0]}`, type, size: 1 });
assertReject({ name: 'reference.gif', type: 'image/gif', size: 1 });
assertReject({ name: 'reference.jpg', type: 'image/png', size: 1 });
validateDesignerReferenceFile({ name: 'max.jpg', type: 'image/jpeg', size: imageLimit });
assertReject({ name: 'large.jpg', type: 'image/jpeg', size: imageLimit + 1 });
validateDesignerReferenceFile({ name: 'max.pdf', type: 'application/pdf', size: pdfLimit });
assertReject({ name: 'large.pdf', type: 'application/pdf', size: pdfLimit + 1 });
validateReferenceItemSelection('shared', []);
validateReferenceItemSelection('items', ['item-a', 'item-b']);
assert.throws(() => validateReferenceItemSelection('items', []));
assert.throws(() => validateReferenceItemSelection('shared', ['item-a']));
console.log('designer reference file validation: passed');
