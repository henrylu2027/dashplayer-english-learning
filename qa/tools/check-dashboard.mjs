/**
 * 学习台口径检查。
 *
 * 前置：数据库里已按预期造好跟读/听写复述/对话测试数据。
 * 运行：node qa/tools/check-dashboard.mjs
 * 产物：打印 dashboard/summary，并保存学习台截图。
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EXE = 'D:\\CherryAgent\\dashplayer-src\\out\\DashPlayer-win32-x64\\DashPlayer.exe';
const PORT = Number(process.env.CDP_PORT || 9334);
const SHOT = 'D:\\CherryAgent\\DashPlayer二开-预览-20261125\\dashboard-practice.png';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, timeout = 90_000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
        try {
            if (await fn()) return;
        } catch {
            // 继续轮询
        }
        await sleep(500);
    }
    throw new Error('等待超时');
}

async function main() {
    const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], { stdio: 'ignore' });
    let browser;
    try {
        await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok);
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
        const page = browser.contexts().flatMap((context) => context.pages())
            .find((item) => !item.url().startsWith('devtools://'));
        await page.waitForFunction(() => Boolean(window.electron && window.electron.call));
        const summary = await page.evaluate(() => window.electron.call('dashboard/summary'));
        console.log('[dashboard]', JSON.stringify(summary, null, 2));
        await page.evaluate(() => {
            window.location.hash = '#/dashboard';
        });
        await sleep(2500);
        fs.mkdirSync(path.dirname(SHOT), { recursive: true });
        await page.screenshot({ path: SHOT });
        console.log('[dashboard] screenshot', SHOT);
    } finally {
        try {
            await browser?.close();
        } catch {
            // 忽略关闭失败
        }
        child.kill();
    }
}

main().catch((error) => {
    console.error('[dashboard] FAILED', error);
    process.exitCode = 1;
});
