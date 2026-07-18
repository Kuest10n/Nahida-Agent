/**
 * 搜索可信度评估模块测试（S0 补测）
 *
 * 覆盖 evaluateUrlCredibility 的评分逻辑边界：
 *   - 政府/教育网站 → high
 *   - 短链/用户生成内容 → low
 *   - HTTP + 可执行文件 → low
 *   - 非法 URL → score 0
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateUrlCredibility,
  scoreSearchResults,
  credibilitySummary,
  type SearchResultItem,
} from '../main/tools/search-credibility';

describe('evaluateUrlCredibility', () => {
  it('政府网站应为高可信', () => {
    const result = evaluateUrlCredibility('https://www.gov.cn/policy');
    expect(result.level).toBe('high');
    expect(result.score).toBeGreaterThanOrEqual(85);
  });

  it('教育机构网站应为高可信', () => {
    const result = evaluateUrlCredibility('https://www.tsinghua.edu.cn/');
    expect(result.level).toBe('high');
    expect(result.score).toBeGreaterThanOrEqual(75);
  });

  it('GitHub 应为高可信', () => {
    const result = evaluateUrlCredibility('https://github.com/user/repo');
    expect(result.level).toBe('high');
  });

  it('MDN 文档应为高可信', () => {
    const result = evaluateUrlCredibility('https://developer.mozilla.org/js');
    expect(result.level).toBe('high');
  });

  it('短链应为低可信', () => {
    const result = evaluateUrlCredibility('http://bit.ly/short-link');
    expect(result.level).toBe('low');
  });

  it('HTTP + 可执行文件应为极低可信', () => {
    const result = evaluateUrlCredibility('http://example.com/file.exe');
    expect(result.level).toBe('low');
    expect(result.score).toBeLessThanOrEqual(30);
  });

  it('非法 URL 应返回 score 0', () => {
    const result = evaluateUrlCredibility('invalid-url');
    expect(result.score).toBe(0);
    expect(result.level).toBe('low');
  });

  it('Reddit 应为低可信（用户生成内容）', () => {
    const result = evaluateUrlCredibility('https://www.reddit.com/r/programming');
    expect(result.level).toBe('low');
  });

  it('HTTPS 普通网站应为中等可信', () => {
    const result = evaluateUrlCredibility('https://www.example.com/article');
    expect(result.level).toBe('medium');
  });

  it('Wikipedia 应为高可信', () => {
    const result = evaluateUrlCredibility('https://en.wikipedia.org/wiki/Nahida');
    expect(result.level).toBe('high');
  });
});

describe('scoreSearchResults', () => {
  it('应按可信度降序排序', () => {
    const results: SearchResultItem[] = [
      { title: '短链', url: 'http://bit.ly/xxx', snippet: 'short' },
      { title: '政府', url: 'https://www.gov.cn/policy', snippet: 'gov' },
      { title: '普通', url: 'https://www.example.com/page', snippet: 'normal' },
    ];
    const scored = scoreSearchResults(results);
    expect(scored[0]!.credibility.score).toBeGreaterThanOrEqual(scored[1]!.credibility.score);
    expect(scored[1]!.credibility.score).toBeGreaterThanOrEqual(scored[2]!.credibility.score);
  });
});

describe('credibilitySummary', () => {
  it('应包含等级和分数', () => {
    const scored = scoreSearchResults([
      { title: 'test', url: 'https://www.gov.cn/', snippet: '' },
    ])[0]!;
    const summary = credibilitySummary(scored);
    expect(summary).toContain('高');
    expect(summary).toContain('/100');
  });
});
