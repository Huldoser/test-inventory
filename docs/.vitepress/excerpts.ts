import type { MarkdownRenderer } from 'vitepress';

/** Marks illustrative fences so copying cannot imply that omitted code is runnable. */
export function excerptBlocks(md: MarkdownRenderer): void {
  const fence = md.renderer.rules.fence as NonNullable<typeof md.renderer.rules.fence>;
  md.renderer.rules.fence = (tokens, index, options, env, renderer) => {
    const excerpt = /\bexcerpt\b/.test(tokens[index].info);
    tokens[index].info = tokens[index].info.replace(/\s+excerpt\b/, '');
    const rendered = fence(tokens, index, options, env, renderer);
    if (!excerpt) return rendered;
    return rendered
      .replace(/<button[^>]*class="copy"[^>]*><\/button>/, '')
      .replace('<div class="language-', '<div data-code-excerpt class="language-')
      .replace('<span class="lang">', '<span class="lang">Excerpt: ');
  };
}
