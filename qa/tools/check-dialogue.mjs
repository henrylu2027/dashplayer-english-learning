/**
 * 场景对话端到端检查。
 *
 * 运行方式（仓库根目录）：
 *   node qa/tools/check-dialogue.mjs
 *
 * 流程：启动打包版 → 用真实视频句生成场景 → 一轮对话 → 复盘 → 好句入复习，
 * 再回到播放器验证「整句学习」回归。测试数据在脚本结束后由 SQL 清理。
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:\\CherryAgent';
const EXE = 'D:\\CherryAgent\\dashplayer-src\\out\\DashPlayer-win32-x64\\DashPlayer.exe';
const PORT = Number(process.env.CDP_PORT || 9333);
const VIDEO_ID = '8460e9d3b8d726cc8b495af596520b339c6a019d';
const VIDEO_DIR = 'H:\\English Learning\\English Animation\\学习英语的幽默';
const VIDEO_NAME = '#Learn English funny 6 #😂  😂 ｜ Funny English Conversations for Beginners ｜ Speak English Easily! #_Learn English language funny _l9OTom_gFMc.mp4';
const VIDEO_PATH = path.join(VIDEO_DIR, VIDEO_NAME);
const SRT_PATH = VIDEO_PATH.replace(/\.mp4$/, '.srt');
const SHOT_DIR = path.join(ROOT, 'DashPlayer二开-预览-20261125');
const WAV_PATH = path.join(ROOT, 'e2e-fixtures', 'dialogue-hello.wav');

const log = (...args) => console.log('[e2e]', ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 轮询等待条件成立。
 * @param {() => Promise<boolean> | boolean} fn 条件。
 * @param {{timeout?: number, interval?: number, label?: string}} options 选项。
 */
async function waitFor(fn, options = {}) {
    const timeout = options.timeout ?? 60_000;
    const interval = options.interval ?? 500;
    const started = Date.now();
    while (Date.now() - started < timeout) {
        try {
            if (await fn()) {
                return;
            }
        } catch {
            // 页面尚未就绪时继续轮询
        }
        await sleep(interval);
    }
    throw new Error(`等待超时：${options.label ?? 'condition'}`);
}

/**
 * 截图并确保目录存在。
 * @param {import('playwright').Page} page 页面。
 * @param {string} name 文件名。
 */
async function shot(page, name) {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, name) });
    log('screenshot', name);
}

async function main() {
    if (!fs.existsSync(VIDEO_PATH)) {
        throw new Error(`测试视频不存在：${VIDEO_PATH}`);
    }
    if (!fs.existsSync(SRT_PATH)) {
        throw new Error(`测试字幕不存在：${SRT_PATH}`);
    }

    log('launch', EXE);
    const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], { stdio: 'ignore' });
    let browser;
    let page;
    try {
        await waitFor(async () => {
            const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
            return response.ok;
        }, { timeout: 90_000, label: 'CDP endpoint' });

        browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
        const pages = browser.contexts().flatMap((context) => context.pages());
        page = pages.find((item) => !item.url().startsWith('devtools://'));
        if (!page) {
            throw new Error('没有找到应用页面');
        }
        await page.waitForFunction(() => Boolean(window.electron && window.electron.call), { timeout: 90_000 });
        log('app ready', await page.title());

        const call0 = (name) => page.evaluate((apiName) => window.electron.call(apiName), name);

        // 1. 可用性
        const availability = await call0('dialogue/availability');
        log('availability', JSON.stringify(availability));

        // 2. 语音转写（合成语音）
        if (fs.existsSync(WAV_PATH)) {
            const base64 = fs.readFileSync(WAV_PATH).toString('base64');
            try {
                const transcript = await page.evaluate(async ({ b64 }) => {
                    const binary = atob(b64);
                    const bytes = new Uint8Array(binary.length);
                    for (let index = 0; index < binary.length; index += 1) {
                        bytes[index] = binary.charCodeAt(index);
                    }
                    return window.electron.call('dialogue/transcribe', { audio: bytes, mimeType: 'audio/wav' });
                }, { b64: base64 });
                log('transcript', JSON.stringify(transcript));
            } catch (error) {
                log('transcript failed', error instanceof Error ? error.message : String(error));
            }
        }

        // 3. 打开播放器并把当前句定位到第一句字幕
        await page.evaluate((id) => {
            window.location.hash = `#/player/${id}?sideBarAnimation=false`;
        }, VIDEO_ID);
        await sleep(6000);
        const hasVideo = await page.evaluate(() => Boolean(document.querySelector('video')));
        log('video element', hasVideo);
        await page.evaluate(() => {
            const video = document.querySelector('video');
            if (video) {
                video.muted = true;
                video.currentTime = 2.6;
                video.dispatchEvent(new Event('timeupdate'));
            }
        });
        await sleep(2000);
        await shot(page, 'dialogue-0-player.png');

        // 4. 进入场景对话
        await page.evaluate(() => {
            window.location.hash = '#/dialogue';
        });
        await sleep(2500);
        let bodyText = await page.locator('body').innerText();
        log('dialogue setup text', bodyText.slice(0, 260).replace(/\n/g, ' | '));

        if (!bodyText.includes('生成场景')) {
            await shot(page, 'dialogue-1-no-sentence.png');
            throw new Error(`没有看到场景设置卡，当前页文本：${bodyText.slice(0, 500)}`);
        }
        if (bodyText.includes('returned an object instead of string')) {
            throw new Error('文案键冲突未修复');
        }
        await shot(page, 'dialogue-1-setup.png');

        // 5. 生成场景
        await page.getByRole('button', { name: '生成场景' }).click();
        await page.getByRole('button', { name: '结束并复盘' }).waitFor({ timeout: 300_000 });
        log('scene generated');
        await shot(page, 'dialogue-2-scene.png');

        // 6. 一轮对话
        const textarea = page.getByPlaceholder('用英文回应；可以先录音，再改文字');
        await textarea.fill('Hi, I need some help. I lost my phone this morning.');
        await page.getByRole('button', { name: '发送' }).click();
        await waitFor(async () => page.evaluate(() => {
            const element = document.querySelector('textarea');
            return Boolean(element && !element.disabled);
        }), { timeout: 300_000, label: 'assistant reply' });
        log('assistant replied');
        await shot(page, 'dialogue-3-chat.png');

        // 7. 复盘
        const beforeOverview = await call0('srs/overview');
        await page.getByRole('button', { name: '结束并复盘' }).click();
        await page.getByText('客观统计').waitFor({ timeout: 300_000 });
        log('review generated');
        await shot(page, 'dialogue-4-review.png');
        await page.getByText('值得复习的句子').scrollIntoViewIfNeeded();
        await shot(page, 'dialogue-4b-goodlines.png');

        // 8. 好句入复习
        const addButtons = page.getByRole('button', { name: '加入复习' });
        const addCount = await addButtons.count();
        log('add-to-review buttons', addCount);
        if (addCount > 0) {
            await addButtons.first().click();
            await sleep(2000);
        }
        const afterOverview = await call0('srs/overview');
        log('srs total', beforeOverview.totalCount, '->', afterOverview.totalCount);

        // 9. 回归：整句学习仍可用
        await page.evaluate((id) => {
            window.location.hash = `#/player/${id}?sideBarAnimation=false`;
        }, VIDEO_ID);
        await sleep(5000);
        const learningButton = page.locator('button[aria-label="整句学习"]').first();
        if (await learningButton.count() > 0) {
            await learningButton.click({ force: true });
            await sleep(4000);
            const input = page.getByPlaceholder('追问点什么，比如：这句话的语气有多重？');
            if (await input.count() > 0) {
                await input.fill('用一句话解释这句话的意思。');
                await page.getByRole('button', { name: '发送' }).first().click();
                await sleep(15_000);
                await shot(page, 'dialogue-5-learning-regression.png');
                log('learning regression attempted');
            } else {
                log('learning input not found, page text', (await page.locator('body').innerText()).slice(0, 300));
            }
        } else {
            log('learning button not found');
        }

        // 10. P0–P3 页面回归
        const pageChecks = [
            ['#/dashboard', '学习台'],
            ['#/shadowing', '跟读打分'],
            ['#/review', '间隔复习'],
            ['#/practice', '听写复述'],
            ['#/dialogue', '场景对话'],
        ];
        for (const [hash, title] of pageChecks) {
            await page.evaluate((target) => {
                window.location.hash = target;
            }, hash);
            await sleep(2000);
            const text = await page.locator('body').innerText();
            if (!text.includes(title)) {
                throw new Error(`页面未正常渲染：${hash}`);
            }
            log('page ok', hash);
        }

        // 11. 历史
        await sleep(1500);
        log('history rendered, body text', (await page.locator('body').innerText()).slice(0, 200).replace(/\n/g, ' | '));
        await shot(page, 'dialogue-6-history.png');

        log('done');
    } finally {
        try {
            await browser?.close();
        } catch {
            // 关闭失败不影响结论
        }
        child.kill();
    }
}

main().catch((error) => {
    console.error('[e2e] FAILED', error);
    process.exitCode = 1;
});
