// POST /api/admin/login
// 站点密码登录已取消：管理员仅经小蓝页 SSO 获得（站主身份）。
// 此端点保留以明确告知调用方改用 SSO，避免旧前端/脚本误以为还能用密码。
import { err } from '../../_lib/store.js';

export async function onRequestPost() {
  return err('use_sso', '本站已取消密码登录：请改用「通过小蓝页登录」按钮，以小蓝页账户（站主=管理员，普通用户=创作者）进入。', 400);
}
