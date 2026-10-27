/**
 * worker.js
 * 出口担当。`placement = smart` で ABEMA に近い拠点（=NRT/東京）で実行させる。
 * 表側からは x-px-raw: 1 が付いてくるので、そのときは書き換えを表側に任せる。
 */

import { handle, buildOptions } from './proxy-core.js';

export default {
  async fetch(request, env) {
    const origin = new URL(request.url).origin;
    const opts = buildOptions(env, { origin, cf: request.cf || null });
    return handle(request, opts);
  }
};