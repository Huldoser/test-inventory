import path from 'node:path';
import { expect, it } from 'vitest';
import { createMarkdownRenderer } from 'vitepress';
import { excerptBlocks } from '../docs/.vitepress/excerpts.ts';

it('marks excerpts visibly and keeps copying available only for complete code fences', async () => {
  const renderer = await createMarkdownRenderer(path.resolve(import.meta.dirname, '../docs'), {
    config: excerptBlocks,
  });
  const html = await renderer.renderAsync(
    ['```js excerpt', "const orderState = 'pending';", '```', '', '```js', "const orderState = 'filled';", '```'].join(
      '\n',
    ),
  );
  expect(html.match(/class="copy"/g)).toHaveLength(1);
  expect(html).toContain('data-code-excerpt');
  expect(html).toContain('Excerpt: js');
  expect(html).toContain('filled');
});
