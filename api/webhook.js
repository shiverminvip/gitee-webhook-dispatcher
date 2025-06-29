// api/webhook.js
const https = require('https');
const crypto = require('crypto'); // 用于 Webhook 签名验证（可选）

// 从 Vercel 环境变量中获取（这些变量将在后面设置）
const GITHUB_PAT = process.env.GITHUB_PAT;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER;
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME;
const GITEE_WEBHOOK_SECRET = process.env.GITEE_WEBHOOK_SECRET; // 可选，但强烈推荐用于安全

// 用于验证 Gitee Webhook 签名的函数（可选，但推荐）
function verifyGiteeSignature(payload, secret, signatureHeader) {
  if (!secret || !signatureHeader) {
    console.warn('Gitee WebHook 密钥或签名头未提供。跳过验证。');
    return true; // 如果未设置密钥，则无法验证，带警告继续。
  }
  // Gitee 对于 Push 事件的 Webhook 配置，如果设置了“密码”，通常会在 X-Gitee-Token 头中发送该密码。
  // 对于 HMAC-SHA256 签名，Gitee 通常使用 'X-Gitee-Signature'。
  // 这里的逻辑是针对 Gitee Webhook 配置中直接使用“密码”的情况进行比较。
  if (signatureHeader === secret) {
    return true;
  }
  console.error('Gitee WebHook 签名不匹配！');
  return false;
}

module.exports = (req, res) => {
  // 确保请求是 POST 方法
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  // 如果配置了密钥，检查 Gitee 的 X-Gitee-Token 头
  const giteeTokenHeader = req.headers['x-gitee-token'];
  if (GITEE_WEBHOOK_SECRET && !verifyGiteeSignature(req.body, GITEE_WEBHOOK_SECRET, giteeTokenHeader)) {
      console.error('无效的 Gitee WebHook 令牌！');
      res.status(403).send('Forbidden: Invalid Gitee Token');
      return;
  }

  // 检查是否是来自 Gitee 的 'Push Hook' 事件
  const giteeEvent = req.headers['x-gitee-event'];
  if (giteeEvent !== 'Push Hook') {
    res.status(200).send(`忽略 Gitee 事件：${giteeEvent}`);
    return;
  }

  console.log('接收到 Gitee push 事件。正在触发 GitHub Actions...');

  // 为 GitHub 的 repository_dispatch 事件准备 payload
  const postData = JSON.stringify({
    event_type: 'gitee_push', // 这必须与你的 GitHub Actions 工作流中定义的 'types' 匹配
    client_payload: {
      gitee_event: giteeEvent,
      timestamp: new Date().toISOString(),
    }
  });

  // 发送给 GitHub API 的 HTTPS 请求选项
  const options = {
    hostname: 'api.github.com',
    port: 443,
    path: `/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/dispatches`,
    method: 'POST',
    headers: {
      'User-Agent': 'Gitee-GitHub-Sync-App', // GitHub API 要求
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `token ${GITHUB_PAT}`, // 使用你的 GitHub PAT 进行身份验证
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  // 向 GitHub API 发送请求
  const githubReq = https.request(options, (githubRes) => {
    let data = '';
    githubRes.on('data', (chunk) => {
      data += chunk;
    });
    githubRes.on('end', () => {
      if (githubRes.statusCode >= 200 && githubRes.statusCode < 300) {
        console.log('GitHub Actions 触发成功！');
        res.status(200).send('GitHub Actions 触发。');
      } else {
        console.error(`触发 GitHub Actions 失败：${githubRes.statusCode} - ${data}`);
        res.status(githubRes.statusCode).send(`触发 GitHub Actions 失败：${data}`);
      }
    });
  });

  githubReq.on('error', (e) => {
    console.error(`GitHub API 请求出现问题：${e.message}`);
    res.status(500).send(`GitHub API 请求错误：${e.message}`);
  });

  githubReq.write(postData);
  githubReq.end();
};
