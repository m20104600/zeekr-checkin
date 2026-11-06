const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../parts/core.js'), 'utf8');
  const ctx = {}; vm.createContext(ctx); vm.runInContext(source, ctx);
  const sel = ctx.zeekrSelectWalkBalls;
  assert.equal(typeof sel, 'function', 'zeekrSelectWalkBalls must exist');
  const balls = (vals) => vals.map((v, i) => ({ id: 'b' + i, val: v, valDefineCode: 'CARBON_VALUE' }));
  // zeekrSelectWalkBalls 跑在 vm 里，返回的数组是 vm realm 的 Array（原型不同于外层），
  // assert/strict 的 deepEqual 会因原型不一致误判。用 Array.from 归一到外层 realm。
  const toArr = (list) => Array.from(list || []);
  const valsOf = (list) => toArr(list).map((b) => b.val).sort((a, b) => a - b);
  const sum = (list) => toArr(list).reduce((a, b) => a + b.val, 0);

  // 1) 未达门槛：一个都不领
  assert.deepEqual(valsOf(sel(balls([100, 200, 300]), 2000)), []);
  assert.deepEqual(valsOf(sel(balls([1999]), 2000)), []);

  // 2) 刚好达标：选正好 2000 的那组，不溢出
  assert.deepEqual(valsOf(sel(balls([2001, 1000, 1000]), 2000)), [1000, 1000]);

  // 3) 单球即超：取最小溢出（不是最少个数）
  //    球 [2001, 1000, 1000]，最优是 1000+1000=2000（溢出 0），不是单取 2001
  assert.equal(sum(sel(balls([2001, 1000, 1000]), 2000)), 2000);

  // 4) 无法正好凑到 2000：取最接近的上界子集和
  //    子集和：1500+600=2100（最优，溢出 100），1500+1000=2500，1000+600+600=2200
  assert.equal(sum(sel(balls([1500, 1000, 600, 600]), 2000)), 2100);

  // 5) 全部刚好凑成门槛
  assert.equal(sum(sel(balls([500, 500, 500, 500]), 2000)), 2000);

  // 6) 必须用尽所有球才达标
  assert.equal(sum(sel(balls([1500, 600]), 2000)), 2100);

  // 7) 0 值球不参与、不被领（最小收取）
  const r0 = sel(balls([0, 1000, 1000, 0]), 2000);
  assert.deepEqual(valsOf(r0), [1000, 1000]);
  assert.equal(r0.length, 2);

  // 8) threshold <= 0 / off：退回旧行为，全部领取（含 0 值球）
  assert.equal(sel(balls([100, 200, 300]), 0).length, 3);
  assert.equal(sel(balls([100, 200, 300]), 'off'.valueOf()).length, 3); // NaN -> 0 path
  // 显式传 0
  assert.equal(sel(balls([5, 5]), 0).length, 2);

  // 9) 空列表
  assert.deepEqual(toArr(sel([], 2000)), []);
  assert.deepEqual(toArr(sel(null, 2000)), []);

  // 10) 较大集合：随机验证「领到的子集和 ≥ 门槛，且是最小上界」
  const rng = (seed) => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 200; t++) {
    const rnd = rng(t + 1);
    const n = 2 + Math.floor(rnd() * 8);
    const list = [];
    for (let i = 0; i < n; i++) list.push({ id: 'x' + i, val: Math.floor(rnd() * 1800) + 50 });
    const total = sum(list);
    const chosen = sel(list, 2000);
    if (total < 2000) {
      assert.equal(chosen.length, 0, 'below threshold must defer all: ' + JSON.stringify(list));
    } else {
      const cs = sum(chosen);
      assert.ok(cs >= 2000, 'chosen must reach threshold: ' + JSON.stringify(list));
      // 暴力验证：没有其他子集的和在 [2000, cs) 之间（cs 是最小上界）
      let best = Infinity;
      for (let mask = 1; mask < (1 << n); mask++) {
        let s = 0;
        for (let i = 0; i < n; i++) if (mask & (1 << i)) s += list[i].val;
        if (s >= 2000 && s < best) best = s;
      }
      assert.equal(cs, best, 'DP must pick min-overshoot subset: ' + JSON.stringify(list));
    }
  }
  console.log('PASS walk threshold DP: defer / exact / min-overshoot / off / random 200 cases');
})().catch((e) => { console.error(e); process.exit(1); });
