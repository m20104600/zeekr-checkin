/**
 * 预加载脚本：删掉全局 fetch，用来验证青龙版在 Node 18 以下环境
 * （或任何没有 fetch 的运行时）会退回 https 模块。
 */
delete globalThis.fetch;
console.log("[test] global fetch 已移除 → 走 https 兜底分支");
