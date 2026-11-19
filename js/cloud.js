// 腾讯云持久化层：WorkBuddy Cloud SDK（CDN 形式）
// publicConfig 来自 workbuddy_cloud_service 激活结果；endpoint 必须来自该配置
import { App, toast } from './state.js';

const PUB = {
  resourceId: 'wbcs_l5SRAhwcdNOP6OM4XLiHHK',
  endpoint: 'https://wbapp-6cx0sv7ijgg9dny3jzqlgp.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_6CX0sV7iJgG9dNY3jZqLgP_LKFEN693OsoBgXjD4HBM5YILaA81yrfj',
};

let cloud = null;
let ready = false;

export function initCloud() {
  if (!window.WorkBuddyCloud?.createWorkBuddyCloud) {
    console.warn('[cloud] SDK 未加载，云端功能不可用');
    return false;
  }
  cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
    endpoint: PUB.endpoint,
    oauthRelayBaseUrl: PUB.oauthRelayBaseUrl,
    publishableKey: PUB.publishableKey,
  });
  ready = true;
  return true;
}

// 入口回调分发：必须早于任何 auth gate
export async function restoreAuth(onUser) {
  if (!ready && !initCloud()) { onUser(null); return null; }
  const url = new URL(location.href);
  const hasCb = url.searchParams.has('code') || url.searchParams.has('error');
  try {
    if (hasCb) {
      const provider = url.searchParams.get('provider');
      let session = null;
      if (provider === 'workbuddy' && typeof cloud.auth.handleWorkBuddyCallback === 'function') {
        session = (await cloud.auth.handleWorkBuddyCallback()).data;
      } else if (provider === 'wechat' && typeof cloud.auth.handleWechatWebCallback === 'function') {
        session = (await cloud.auth.handleWechatWebCallback()).data;
      }
      if (session) {
        for (const k of ['code', 'state', 'provider']) url.searchParams.delete(k);
        history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
      onUser(session?.user || null);
      return session;
    }
    const { data: session } = await cloud.auth.getSession();
    onUser(session?.user || null);
    return session;
  } catch (e) {
    console.warn('[cloud] restoreAuth failed', e?.message);
    onUser(null);
    return null;
  }
}

// WorkBuddy 账号登录：同标签页跳转，redirectTo 必须是站点根路径（保留业务参数）
export async function signIn() {
  if (!ready && !initCloud()) return;
  const back = new URL(location.href);
  back.pathname = '/';
  for (const k of ['code', 'state', 'provider']) back.searchParams.delete(k);
  const { data, error } = await cloud.auth.signInWithOAuth({
    provider: 'workbuddy',
    redirectTo: back.toString(),
  });
  if (error) { toast('登录失败：' + error.message); return; }
  if (data?.url) location.assign(data.url);
}

export async function signOut() {
  if (!ready) return;
  await cloud.auth.signOut();
  App.cloudUser = null;
  toast('已退出登录');
}

export async function getSession() {
  if (!ready) return null;
  const { data } = await cloud.auth.getSession();
  return data || null;
}

// ---- 云端存档：wb_saves 表，owner 隔离 ----
// 约定：slot = worldId（一个世界一行）。默认 'main' 只为兼容旧调用，
// 新代码必须显式传 slot（见 docs/architecture/ADR.md ADR-01/ADR-03）。
function normalizeSlot(slot) {
  return (typeof slot === 'string' && slot.trim()) ? slot.trim() : 'main';
}

export async function cloudLoad(slot = 'main') {
  const session = await getSession();
  if (!session) return null;
  const key = normalizeSlot(slot);
  const { data, error } = await cloud.database
    .from('wb_saves').select('payload, world_name, updated_at').eq('slot', key).maybeSingle();
  if (error) { console.warn('[cloud] load error', error.message); return null; }
  return data || null;
}

export async function cloudSave(payload, worldName, slot = 'main') {
  const session = await getSession();
  if (!session) return false;
  const key = normalizeSlot(slot);
  const row = {
    slot: key,
    world_name: worldName || '未命名世界',
    payload,
    owner_name: session.user?.name || null,
    updated_at: new Date().toISOString(),
  };
  // 先查是否已存在该 slot（唯一键 owner_id+slot）
  const { data: existing } = await cloud.database
    .from('wb_saves').select('id').eq('slot', key).maybeSingle();
  let res;
  if (existing) {
    res = await cloud.database.from('wb_saves').update(row).eq('id', existing.id).select();
  } else {
    res = await cloud.database.from('wb_saves').insert(row).select();
  }
  if (res.error) { console.warn('[cloud] save error', res.error.message); toast('云端保存失败'); return false; }
  return true;
}

// 拉取当前用户可见的全部云端世界元数据（RLS 负责用户隔离）。
// 只取元数据，不取 payload；排序在调用方做，避免依赖未确认的 SDK .order API。
export async function listCloudWorlds() {
  if (!ready && !initCloud()) return [];
  const session = await getSession();
  if (!session) return [];
  const { data, error } = await cloud.database
    .from('wb_saves').select('id, slot, world_name, created_at, updated_at');
  if (error) { console.warn('[cloud] list error', error.message); return []; }
  return (data || []).filter(r => r && typeof r.slot === 'string' && r.slot.trim()).map(r => ({
    id: r.slot.trim(),
    remoteId: r.id,
    name: r.world_name || '未命名世界',
    createdAt: r.created_at || null,
    updatedAt: r.updated_at || null,
    source: 'cloud',
  }));
}

export function isCloudReady() { return ready; }
