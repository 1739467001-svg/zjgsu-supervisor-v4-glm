export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * 部署在反向代理子路径（如 http://host/zjgsu-supervisor/）时，
 * 构建期通过 VITE_BASE_PATH 注入 "/zjgsu-supervisor"；直部署在根路径则留空。
 * 所有"根相对"的跳转与 API 地址统一经过它拼接，wouter 的 Router base 也取自它。
 */
export const BASE_PATH: string = (import.meta.env.VITE_BASE_PATH ?? "").replace(/\/+$/, "");

// 运行时生成登录地址，使跳转 URI 反映当前 origin。
export const getLoginUrl = () => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  // 如果没有配置 OAuth 服务，直接使用本地工号登录页
  if (!oauthPortalUrl) {
    return `${BASE_PATH}/login`;
  }
  const appId = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}${BASE_PATH}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};
