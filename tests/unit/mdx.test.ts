import { splitFrontmatter, mdxToMarkdown, detectLanguage } from '../../src/utils/mdx';

describe('splitFrontmatter', () => {
  it('extracts title and description and returns the body', () => {
    const raw = '---\ntitle: "Queries"\ndescription: Read data without consensus\n---\n\nBody text';
    const fm = splitFrontmatter(raw);
    expect(fm.title).toBe('Queries');
    expect(fm.description).toBe('Read data without consensus');
    expect(fm.body.trim()).toBe('Body text');
  });

  it('returns the whole text as body when there is no frontmatter', () => {
    expect(splitFrontmatter('# Hello').body).toBe('# Hello');
  });
});

describe('mdxToMarkdown', () => {
  it('drops imports, media and custom components but keeps prose', () => {
    const md = mdxToMarkdown(
      'import { X } from "y";\n\n<LocalNodeDeprecation />\n\n<Frame><img src="/a.png" /></Frame>\n\nReal content ![alt](/img.png) here.'
    );
    expect(md).not.toContain('import');
    expect(md).not.toContain('LocalNodeDeprecation');
    expect(md).not.toContain('img');
    expect(md).toContain('Real content');
    expect(md).toContain('here.');
  });

  it('turns callouts, tabs and cards into text', () => {
    const md = mdxToMarkdown(
      '<Note>Use the mirror node.</Note>\n<Tabs><Tab title="JavaScript">js text</Tab><Tab title="Java">java text</Tab></Tabs>\n<Card title="Tokens" icon="coins">desc</Card>'
    );
    expect(md).toContain('> **Note:** Use the mirror node.');
    expect(md).toContain('### JavaScript');
    expect(md).toContain('### Java');
    expect(md).toContain('**Tokens**');
    expect(md).not.toContain('<Tab');
    expect(md).not.toContain('<Card');
  });

  it('leaves code fences untouched, including JSX-looking content inside them', () => {
    const fence = '```javascript\nconst x = <Note>not a callout</Note>;\nimport a from "b";\n```';
    const md = mdxToMarkdown(`Intro\n\n${fence}\n\nOutro`);
    expect(md).toContain(fence);
  });
});

describe('detectLanguage', () => {
  it('returns the most frequent fenced language', () => {
    const text = '```java\na\n```\n```js\nb\n```\n```java\nc\n```';
    expect(detectLanguage(text)).toBe('java');
  });

  it('maps aliases and ignores unknown languages', () => {
    expect(detectLanguage('```ts\nx\n```')).toBe('typescript');
    expect(detectLanguage('```bash\nx\n```')).toBeUndefined();
    expect(detectLanguage('no code')).toBeUndefined();
  });
});
