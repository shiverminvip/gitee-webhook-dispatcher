// netlify/functions/gitee-dispatcher.js
const https = require('https'); // Node.js 内置模块
// const crypto = require('crypto'); // 仅在需要 HMAC 签名验证时需要

// 从 Netlify 环境变量中获取
// 确保这些变量已在 Netlify 后台设置
const GITHUB_PAT = process.env.GITHUB_PAT;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER;
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME;
const GITEE_WEBHOOK_SECRET = process.env.GITEE_WEBHOOK_SECRET; // 可选，但强烈推荐

// Netlify Functions 的主入口点
exports.handler = async (event, context) => {
    // 1. 处理 GET 请求（用于预热/健康检查）
    if (event.httpMethod === 'GET') {
        console.log('Received GET request for pre-warming/health check.');
        return {
            statusCode: 200,
            body: 'Netlify function is active and listening.'
        };
    }

    // 2. 确保是 POST 请求
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: 'Method Not Allowed'
        };
    }

    // 3. 验证 Gitee WebHook Secret (如果设置了)
    // Gitee 的 Webhook secret 通常在 headers['x-gitee-token'] 中
    const giteeTokenHeader = event.headers['x-gitee-token'];
    if (GITEE_WEBHOOK_SECRET && giteeTokenHeader !== GITEE_WEBHOOK_SECRET) {
        console.error('Invalid Gitee WebHook token!');
        return {
            statusCode: 403,
            body: 'Forbidden: Invalid Gitee Token'
        };
    }

    // 4. 检查是否是 'Push Hook' 事件
    const giteeEvent = event.headers['x-gitee-event'];
    if (giteeEvent !== 'Push Hook') {
        console.log(`Ignoring Gitee event: ${giteeEvent}`);
        return {
            statusCode: 200,
            body: `Ignoring Gitee event: ${giteeEvent}`
        };
    }

    // 5. 解析 Gitee Payload (Netlify event.body 是字符串)
    let giteePayload;
    try {
        giteePayload = JSON.parse(event.body);
    } catch (error) {
        console.error('Failed to parse Gitee payload:', error);
        return {
            statusCode: 400,
            body: 'Bad Request: Invalid JSON payload'
        };
    }

    console.log('Received Gitee push event. Triggering GitHub Actions...');

    // 6. 准备 GitHub Actions 的 repository_dispatch payload
    const postData = JSON.stringify({
        event_type: 'gitee_push', // 必须匹配 GitHub Actions 工作流中定义的 'types'
        client_payload: {
            gitee_event: giteeEvent,
            timestamp: new Date().toISOString(),
            ref: giteePayload.ref, // 可以传递 Gitee 的 ref 信息
            repository: giteePayload.repository.full_name // 传递 Gitee 仓库全名
        }
    });

    // 7. 配置 HTTPS 请求到 GitHub API
    const options = {
        hostname: 'api.github.com',
        port: 443,
        path: `/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/dispatches`,
        method: 'POST',
        headers: {
            'User-Agent': 'Gitee-GitHub-Sync-Netlify-App',
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': `token ${GITHUB_PAT}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    // 8. 发送请求到 GitHub API
    return new Promise((resolve, reject) => {
        const githubReq = https.request(options, (githubRes) => {
            let data = '';
            githubRes.on('data', (chunk) => {
                data += chunk;
            });
            githubRes.on('end', () => {
                if (githubRes.statusCode >= 200 && githubRes.statusCode < 300) {
                    console.log('GitHub Actions triggered successfully!');
                    resolve({
                        statusCode: 200,
                        body: 'GitHub Actions triggered.'
                    });
                } else {
                    console.error(`Failed to trigger GitHub Actions: ${githubRes.statusCode} - ${data}`);
                    resolve({
                        statusCode: githubRes.statusCode,
                        body: `Failed to trigger GitHub Actions: ${data}`
                    });
                }
            });
        });

        githubReq.on('error', (e) => {
            console.error(`Problem with GitHub API request: ${e.message}`);
            reject({
                statusCode: 500,
                body: `GitHub API request error: ${e.message}`
            });
        });

        githubReq.write(postData);
        githubReq.end();
    });
};
