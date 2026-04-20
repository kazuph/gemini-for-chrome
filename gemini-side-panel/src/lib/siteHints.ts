export interface SiteHint {
  hostMatcher: RegExp
  name: string
  hint: string // markdownでsystem promptに注入される
}

export const SITE_HINTS: SiteHint[] = [
  {
    hostMatcher: /(^|\.)amazon\.(co\.jp|com|de|fr|co\.uk)$/,
    name: 'Amazon',
    hint: `### Amazon-specific hints (updated for 2026 DOM)

## ⚠️ MANDATORY 4-STEP SEARCH SEQUENCE — DO NOT SKIP ANY STEP

This is the most common failure mode: skipping step 2 and jumping to wait_for_element. Follow EXACTLY in this order, emitting each tool call one after the other:

1. \`fill_element\`({ selector: '#twotabsearchtextbox', value: 'YOUR_KEYWORD' })
2. \`click_element\`({ selector: '#nav-search-submit-button' })   ← **DO NOT FORGET THIS.** Without the click, the tab stays at \`/ref=nav_logo\` and the next step WILL time out.
3. \`wait_for_element\`({ selector: '[data-component-type="s-search-result"]', timeout_ms: 10000 })   ← use 10000ms, Amazon's SERP is slow
4. \`run_js\`({ code: <extraction script using the template below> })

Common failure: **fill_element → wait_for_element** without the intervening click_element. If you see "Timeout waiting for [data-component-type=\\"s-search-result\\"]" that means you skipped step 2. Go back and call click_element on \`#nav-search-submit-button\`.

Alternative to step 2 (less reliable but OK): \`press_key({ key: 'Enter', selector: '#twotabsearchtextbox' })\` — but prefer click_element because pressing Enter sometimes no-ops on Amazon.

## General Amazon Info
- **Search flow (legacy summary)**: fill_element('#twotabsearchtextbox', KEYWORD) → click_element('#nav-search-submit-button') → wait_for_element('[data-component-type="s-search-result"]')
- **Product cards**: \`div[data-component-type="s-search-result"]\` (typically 16-24 per page, plus sponsored cards)
- **Product title** (⚠ 2026 DOM has NO heading tags): use \`img.s-image\`'s \`alt\` attribute. Strip the "スポンサー広告 - " / "Sponsored - " prefix for sponsored cards.
- **URL**: first \`a.a-link-normal\` inside the card has the product href. Sponsored cards go via \`/sspa/click?...\` — resolve to absolute URL with \`new URL(href, location.origin).href\`.
- **Price**: \`.a-price .a-offscreen\` (full formatted, e.g. "￥1,980"). Fallback: \`.a-price-whole\` (digits without "￥").
- **Rating**: \`.a-icon-star-small .a-icon-alt\` (e.g. "5つ星のうち4.3") — may be absent on new products.
- **Review count**: \`span[aria-label$="件のレビュー"]\` or the rating sibling.
- **Sponsored flag**: \`.puis-sponsored-label-text\` or alt text prefix.
- ⚠ **Selectors that used to work but no longer do in 2026**: \`h2\`, \`h2 a span\`, \`.a-text-normal\` as title — Amazon removed these. If you write a run_js using \`h2\`, every title will be undefined.
- **One-shot extraction (strongly preferred, updated)**:
\`\`\`js
const cards = document.querySelectorAll('[data-component-type="s-search-result"]');
return Array.from(cards).slice(0, 20).map(c => {
  const img = c.querySelector('img.s-image');
  const link = c.querySelector('a.a-link-normal[href*="/dp/"], a.a-link-normal[href*="/gp/"], a.a-link-normal');
  const rawTitle = img?.alt ?? '';
  const isSponsored = /^(スポンサー広告|Sponsored)\\s*-\\s*/i.test(rawTitle);
  return {
    title: rawTitle.replace(/^(スポンサー広告|Sponsored)\\s*-\\s*/i, '').trim() || null,
    sponsored: isSponsored,
    price: c.querySelector('.a-price .a-offscreen')?.textContent?.trim() ?? c.querySelector('.a-price-whole')?.textContent?.trim() ?? null,
    rating: c.querySelector('.a-icon-star-small .a-icon-alt')?.textContent?.trim() ?? null,
    url: link ? new URL(link.getAttribute('href') || '', location.origin).href : null,
  };
}).filter(p => p.title);
\`\`\`
Use \`run_js\` for extraction — it is far more reliable than looping find_elements / get_text on Amazon's deeply nested DOM. **If your first run_js returns items with all titles undefined, inspect with get_html once to find the current title source (usually img alt) — do NOT retry the same run_js; it will keep failing.**`,
  },
  {
    hostMatcher: /(^|\.)google\.(com|co\.jp)$/,
    name: 'Google Search',
    hint: `### Google Search-specific hints
- **Search input**: \`textarea[name="q"]\` (NOT input)
- **Search flow**: fill_element('textarea[name="q"]', KEYWORD) → press_key('Enter', selector='textarea[name="q"]')
- **Results**: \`#search div[data-sokoban-container]\` or \`#rso > div\`
- **Per-result title**: \`h3\` within each result container
- **Per-result URL**: \`a[href]\` within each result container (first match)
- **Per-result snippet**: \`[data-sncf="1"]\` or \`.VwiC3b\`
- Use \`run_js\` to iterate results:
\`\`\`js
return Array.from(document.querySelectorAll('#rso > div')).slice(0, 10).map(r => ({
  title: r.querySelector('h3')?.textContent,
  url: r.querySelector('a[href]')?.href,
  snippet: r.querySelector('.VwiC3b')?.textContent,
}));
\`\`\``,
  },
  {
    hostMatcher: /(^|\.)youtube\.com$/,
    name: 'YouTube',
    hint: `### YouTube-specific hints
- **Search input**: \`input#search\` (inside \`<ytd-searchbox>\`)
- **Search submit**: \`#search-icon-legacy\` or press_key('Enter', selector='input#search')
- **Video cards on search results**: \`ytd-video-renderer\`
- **Per-card title**: \`#video-title\` (an anchor; text + href both useful)
- **Per-card channel**: \`ytd-channel-name a\`
- **Per-card duration**: \`span.ytd-thumbnail-overlay-time-status-renderer\`
- **Per-card views / age**: \`#metadata-line span\` (first = views, second = age)
- Use \`run_js\` for bulk extraction.
- **Note**: YouTube is a Shadow DOM heavy SPA. If \`querySelector\` returns 0, try waiting with \`wait_for_element\` for dynamic load.`,
  },
  {
    hostMatcher: /(^|\.)zenn\.dev$/,
    name: 'Zenn',
    hint: `### Zenn-specific hints
- **Article title**: \`h1.View_title__*\` or just the first \`h1\`
- **Article body**: \`div.znc\` (the main markdown-rendered content)
- **Author**: \`.ArticleHeaderPublication_userInfo__* a\`
- **Like button**: Two exist; the **visible one** is at page bottom above the author profile — \`button[aria-label="いいね"]\` (picker auto-skips the hidden duplicate)
- **Comments**: \`section[aria-labelledby*="comments"]\`
- For article summaries prefer \`read_page\` (Readability is optimized for Zenn).`,
  },
  {
    hostMatcher: /(^|\.)x\.com$|(^|\.)twitter\.com$/,
    name: 'X / Twitter',
    hint: `### X / Twitter-specific hints
- **Tweet compose**: \`div[data-testid="tweetTextarea_0"]\` (contenteditable, use fill_element)
- **Post button**: \`button[data-testid="tweetButtonInline"]\`
- **Timeline tweets**: \`article[data-testid="tweet"]\`
- **Per-tweet text**: \`div[data-testid="tweetText"]\`
- **Per-tweet author**: \`div[data-testid="User-Name"] a\`
- Infinite scroll — use \`scroll_by(0, 900)\` progressively, NOT \`scroll_to_bottom\` (timeline is virtually unbounded).`,
  },
  {
    hostMatcher: /(^|\.)github\.com$/,
    name: 'GitHub',
    hint: `### GitHub-specific hints
- **Repo README**: \`article.markdown-body\`
- **Issue / PR body**: \`.comment-body.markdown-body\`
- **File list in repo**: \`[aria-labelledby="files"] a.Link--primary\`
- **Search**: navigate_to_url to \`/search?q=X\` for reliability instead of fighting the header search box.`,
  },
]

export function getSiteHint(urlString: string | undefined): SiteHint | null {
  if (!urlString) return null
  try {
    const host = new URL(urlString).hostname.toLowerCase()
    return SITE_HINTS.find((h) => h.hostMatcher.test(host)) ?? null
  } catch {
    return null
  }
}

export function buildSiteHintSection(urlString: string | undefined): string {
  const hint = getSiteHint(urlString)
  if (!hint) return ''
  return `\n\n## Site-specific Playbook: ${hint.name}\n\n${hint.hint}\n\n**Follow the above playbook exactly before falling back to generic selectors.**\n`
}
