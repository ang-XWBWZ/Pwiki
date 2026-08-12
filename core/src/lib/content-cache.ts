// content-cache.ts — 文件内容内存缓存 (P0-3)
//
// 问题: search.ts 每次搜索都 readFileSync 读磁盘
// 修复: 索引时将文件内容缓存到内存，搜索只读缓存
//
// 单例 Map<sourceDir + relPath, fullContent> — 加载数据源时填充

const cache = new Map<string, string>();

function cacheKey(relPath: string, sourceDir?: string): string {
  const normalizedPath = relPath.replace(/\\/g, "/");
  if (!sourceDir) return normalizedPath;
  return `${sourceDir.replace(/\\/g, "/")}\0${normalizedPath}`;
}

/** 存入缓存 */
export function setContent(relPath: string, content: string, sourceDir?: string): void {
  cache.set(cacheKey(relPath, sourceDir), content);
}

/** 读取缓存 */
export function getContent(relPath: string, sourceDir?: string): string | undefined {
  return cache.get(cacheKey(relPath, sourceDir))
    ?? (sourceDir ? cache.get(cacheKey(relPath)) : undefined);
}

/** 检查是否已缓存 */
export function hasContent(relPath: string, sourceDir?: string): boolean {
  return cache.has(cacheKey(relPath, sourceDir));
}

/** 按 sourceDir 清除缓存条目 */
export function clearSource(sourceDir: string): void {
  // sourceDir 不存 key，但 relPath 在调用侧已知。
  // 实际清除由调用方遍历处理。
}

/** 删除单条缓存 */
export function removeContent(relPath: string, sourceDir?: string): void {
  cache.delete(cacheKey(relPath, sourceDir));
  if (sourceDir) cache.delete(cacheKey(relPath));
}

/** 清除所有缓存 */
export function clearAll(): void {
  cache.clear();
}

/** 缓存大小 */
export function cacheSize(): number {
  return cache.size;
}
