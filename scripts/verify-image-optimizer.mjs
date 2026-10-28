import assert from 'node:assert/strict';
import { Transformer } from '@napi-rs/image';
import { minifyImages } from '../config/webpack/optimizers.js';

const pixels = Buffer.alloc(32 * 32 * 4);
for (let index = 0; index < pixels.length; index += 1) {
  pixels[index] = (index * 53 + 17) % 256;
}

const png = await Transformer.fromRgbaPixels(pixels, 32, 32).png();
const jpeg = await Transformer.fromRgbaPixels(pixels, 32, 32).jpeg(83);
const results = [];
for (const [filename, data] of [
  ['images/example.png', png],
  ['images/example.jpg', jpeg],
]) {
  const original = { filename, data, info: {}, warnings: [], errors: [] };
  const result = await minifyImages(original);
  assert.ok(result, String(original.errors));
  assert.equal(result.filename, filename);
  assert.equal(result.info.minimized, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(
    await new Transformer(result.data).rawPixels(),
    await new Transformer(data).rawPixels(),
  );
  const metadata = await new Transformer(result.data).metadata();
  assert.equal(metadata.format, filename.endsWith('.png') ? 'png' : 'jpeg');
  assert.equal(metadata.width, 32);
  assert.equal(metadata.height, 32);
  if (filename.endsWith('.jpg')) {
    assert.ok(
      result.data.includes(Buffer.from([0xff, 0xc2])),
      'JPEG output must remain progressive',
    );
  }
  results.push({
    filename,
    format: metadata.format,
    inputBytes: data.length,
    outputBytes: result.data.length,
    pixelsPreserved: true,
  });
}

assert.equal(await minifyImages({ filename: 'image.svg' }), null);
const invalid = {
  filename: 'invalid.png',
  data: Buffer.from('invalid'),
  info: {},
  warnings: [],
  errors: [],
};
assert.equal(await minifyImages(invalid), null);
assert.equal(
  invalid.errors.length,
  1,
  'Invalid image errors must reach Webpack',
);
console.log(JSON.stringify(results, null, 2));
