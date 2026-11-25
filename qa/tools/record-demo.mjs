/**
 * 演示视频录制脚本。
 *
 * 用 CDP screencast 抓应用画面（gdigrab 对 Chromium GPU 窗口是黑屏），
 * 驱动真实操作走一遍 P0–P4，再按帧时间戳合成视频并烧入中英文字幕。
 *
 * 运行（仓库根目录）：
 *   node qa/tools/record-demo.mjs
 *
 * 前置：
 * - 打包产物已是最新；
 * - `D:\CherryAgent\e2e-fixtures\demo-sentence.wav` 存在（SAPI 合成，冒充麦克风）；
 * - 真实数据库已清空测试数据，演示会写入真实记录。
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:\\CherryAgent';
const EXE = 'D:\\CherryAgent\\dashplayer-src\\out\\DashPlayer-win32-x64\\DashPlayer.exe';
const FFMPEG = 'D:\\CherryAgent\\dashplayer-src\\lib\\ffmpeg.exe';
const PORT = Number(process.env.CDP_PORT || 9336);
const VIDEO_ID = '8460e9d3b8d726cc8b495af596520b339c6a019d';
const WAV_PATH = path.join(ROOT, 'e2e-fixtures', 'demo-sentence.wav');
const OUT_DIR = path.join(ROOT, '作品集');
const FRAME_DIR = path.join(OUT_DIR, 'demo-frames');
const SHOT_DIR = path.join(OUT_DIR, 'assets');
const RAW_VIDEO = path.join(OUT_DIR, 'demo-raw.mp4');
const FINAL_VIDEO = path.join(OUT_DIR, '演示视频.mp4');
const SUBS = path.join(OUT_DIR, 'demo-subs.srt');

const SENTENCE = 'Rose, I have a problem. What happened?';

const log = (...args) => console.log('[demo]', ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 等待一个条件成立。
 * @param {() => Promise<boolean> | boolean} fn 条件。
 * @param {number} timeout 超时毫秒。
 * @param {string} label 日志标签。
 */
async function waitFor(fn, timeout, label) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
        try {
            if (await fn()) return;
        } catch {
            // 继续轮询
        }
        await sleep(300);
    }
    throw new Error(`等待超时：${label}`);
}

/**
 * 点击左侧导航项。
 * @param {import('playwright').Page} page 页面。
 * @param {string} label 导航文案。
 */
async function clickNav(page, label) {
    await page.locator('[role="button"]').filter({ hasText: label }).first().click();
    await sleep(1200);
}

/**
 * 截图到作品集素材目录。
 * @param {import('playwright').Page} page 页面。
 * @param {string} name 文件名。
 */
async function shot(page, name) {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, name) });
    log('screenshot', name);
}

/**
 * 把合成语音接到 getUserMedia，充当麦克风。
 * @param {import('playwright').Page} page 页面。
 * @param {string} base64 WAV 文件的 base64。
 */
async function installFakeMic(page, base64) {
    await page.evaluate(async (b64) => {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        const context = new AudioContext();
        await context.resume();
        const buffer = await context.decodeAudioData(bytes.buffer);
        const destination = context.createMediaStreamDestination();
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(destination);
        source.start();
        window.__fakeMic = { context, source, destination };
        // 每次录音返回克隆音轨：录音器停止时会 stop 自己的音轨，
        // 直接复用同一个 stream 会导致下一次录音拿到已结束的轨道。
        navigator.mediaDevices.getUserMedia = async () => destination.stream.clone();
    }, base64);
}

/**
 * 秒转 SRT 时间戳。
 * @param {number} seconds 秒。
 */
function srtTime(seconds) {
    const ms = Math.max(0, Math.round(seconds * 1000));
    const h = String(Math.floor(ms / 3_600_000)).padStart(2, '0');
    const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0');
    const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0');
    const rest = String(ms % 1000).padStart(3, '0');
    return `${h}:${m}:${s},${rest}`;
}

/**
 * 用帧文件和时间戳生成视频。
 * @param {Array<{file: string, ts: number}>} frames 帧列表。
 * @param {number} endTs 结束时间戳（秒）。
 */
async function buildVideo(frames, endTs) {
    if (frames.length < 2) {
        throw new Error('录到的帧太少，无法生成视频');
    }
    const listLines = [];
    for (let index = 0; index < frames.length; index += 1) {
        const current = frames[index];
        const next = frames[index + 1];
        const duration = Math.max(0.05, (next ? next.ts : endTs) - current.ts);
        listLines.push(`file '${current.file}'`);
        listLines.push(`duration ${duration.toFixed(3)}`);
    }
    listLines.push(`file '${frames.at(-1).file}'`);
    fs.writeFileSync(path.join(FRAME_DIR, 'list.txt'), listLines.join('\n'), 'utf8');

    await new Promise((resolve, reject) => {
        const ff = spawn(FFMPEG, [
            '-y', '-hide_banner',
            '-f', 'concat', '-safe', '0', '-i', 'list.txt',
            '-vf', 'fps=12,scale=trunc(iw/2)*2:trunc(ih/2)*2',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
            '-pix_fmt', 'yuv420p',
            '../demo-raw.mp4',
        ], { cwd: FRAME_DIR, stdio: 'ignore' });
        ff.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 合成失败：${code}`))));
    });
    log('raw video built', RAW_VIDEO);
}

/**
 * 把字幕烧进视频。
 */
async function burnSubtitles() {
    await new Promise((resolve, reject) => {
        const ff = spawn(FFMPEG, [
            '-y', '-hide_banner',
            '-i', 'demo-raw.mp4',
            '-vf', "subtitles=demo-subs.srt:force_style='FontName=Microsoft YaHei,FontSize=19,PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BorderStyle=1,Outline=1.4,Shadow=0,MarginV=28'",
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
            '-pix_fmt', 'yuv420p',
            '演示视频.mp4',
        ], { cwd: OUT_DIR, stdio: 'ignore' });
        ff.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`字幕烧录失败：${code}`))));
    });
    log('final video', FINAL_VIDEO);
}

async function main() {
    if (!fs.existsSync(WAV_PATH)) {
        throw new Error(`演示语音不存在：${WAV_PATH}`);
    }
    if (fs.existsSync(FRAME_DIR)) {
        fs.rmSync(FRAME_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(FRAME_DIR, { recursive: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const child = spawn(EXE, [
        `--remote-debugging-port=${PORT}`,
        // 无真人手势时也允许 AudioContext 运行，保证合成语音能进 MediaRecorder
        '--autoplay-policy=no-user-gesture-required',
    ], { stdio: 'ignore' });
    let browser;
    try {
        await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok, 90_000, 'CDP');
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
        const page = browser.contexts().flatMap((context) => context.pages())
            .find((item) => !item.url().startsWith('devtools://'));
        await page.waitForFunction(() => Boolean(window.electron && window.electron.call), { timeout: 90_000 });
        await page.bringToFront();

        // 先打开播放器并定位到第一句，录屏从稳定的画面开始
        await page.evaluate((id) => {
            window.location.hash = `#/player/${id}?sideBarAnimation=false`;
        }, VIDEO_ID);
        await sleep(8000);
        /**
         * 把视频固定在第一条字幕：暂停并阻止播放器后续自动恢复播放。
         * 播放器会在 timeupdate 里回写当前句，这里主动派发一次让状态立刻同步。
         */
        const pinFirstLine = async () => {
            await page.evaluate(() => {
                const video = document.querySelector('video');
                if (!video) {
                    return;
                }
                video.muted = true;
                video.pause();
                video.currentTime = 2.6;
                // 演示只需要定格画面，阻止播放器把视频重新播起来
                video.play = () => Promise.resolve();
                video.dispatchEvent(new Event('timeupdate'));
            });
            await sleep(1500);
        };
        await pinFirstLine();
        // 播放器可能弹出“播放不顺畅”的修复提示，演示时先关掉
        const ignoreButton = page.getByRole('button', { name: '暂时忽略' });
        if (await ignoreButton.count() > 0) {
            await ignoreButton.first().click();
            await sleep(500);
        }

        // 播放器画面上看不到字幕文本，用跟读页的文本框确认当前句已经绑定
        await page.evaluate(() => {
            window.location.hash = '#/shadowing';
        });
        await sleep(2500);
        const reference = await page.locator('textarea').first().inputValue();
        if (!reference.includes('Rose, I have a problem.')) {
            throw new Error(`当前句没有绑定到目标字幕：${reference}`);
        }
        await page.evaluate((id) => {
            window.location.hash = `#/player/${id}?sideBarAnimation=false`;
        }, VIDEO_ID);
        await sleep(4000);
        await pinFirstLine();
        if (await ignoreButton.count() > 0) {
            await ignoreButton.first().click();
            await sleep(500);
        }
        await installFakeMic(page, fs.readFileSync(WAV_PATH).toString('base64'));

        // 固定节奏截图：CDP screencast 的帧时间戳会被事件循环拖长，导致画面和字幕对不上；
        // 截图的时间戳由本机时钟给出，配合动作标记可以精确合成。
        const startedAt = Date.now();
        const frames = [];
        let frameIndex = 0;
        let capturing = true;
        const capturePromise = (async () => {
            while (capturing) {
                const ts = Date.now() / 1000;
                const file = `frame-${String(frameIndex).padStart(5, '0')}.png`;
                frameIndex += 1;
                try {
                    await page.screenshot({ path: path.join(FRAME_DIR, file) });
                    frames.push({ file, ts });
                } catch {
                    // 页面切换瞬间截图可能失败，跳过这一帧
                }
                await sleep(350);
            }
        })();
        await sleep(500);
        const baseTs = frames.length > 0 ? frames[0].ts : startedAt / 1000;
        const marks = [];
        const mark = (text) => {
            marks.push({ at: Date.now() / 1000 - baseTs, text });
            log('mark', marks.at(-1).at.toFixed(1), text.split('\n')[0]);
        };

        // 1. 播放器
        mark('看视频学英语：从一句台词开始\nLearning English from one line');
        await sleep(5000);

        // 2. 跟读
        await clickNav(page, '跟读打分');
        mark('跟读：本地逐词评测\nShadowing: word-level scoring, on device');
        await sleep(2500);
        await page.getByRole('button', { name: '取当前句' }).click();
        await sleep(1500);
        await page.locator('button[aria-label="开始录音"]').click();
        await sleep(6500);
        await page.locator('button[aria-label="结束录音"]').click();
        await page.getByRole('button', { name: '加入复习' }).first().waitFor({ timeout: 90_000 });
        await sleep(3000);
        await shot(page, 'demo-shadowing-result.png');
        mark('读对、读错、漏读逐词标注\nCorrect, wrong, missing words are marked');
        await sleep(5000);

        // 3. 加入复习
        await page.getByRole('button', { name: '加入复习' }).first().click();
        mark('达标句子进入同一个复习队列\nPassed lines enter one review queue');
        await sleep(2500);

        // 4. 复习
        await clickNav(page, '间隔复习');
        mark('复习不是看卡片，而是再读一遍\nReview means shadowing again, not card reading');
        await sleep(4000);
        await shot(page, 'demo-review.png');

        // 5. 听写
        await clickNav(page, '听写复述');
        mark('听写：逐词校对\nDictation: word-by-word check');
        await sleep(2500);
        await page.getByPlaceholder('在这里输入你听到的句子').fill('Rose, I have a problem. What happend?');
        await sleep(1200);
        await page.getByRole('button', { name: '校对' }).click();
        await page.getByText('词准确率').first().waitFor({ timeout: 60_000 });
        await sleep(3000);
        await shot(page, 'demo-dictation.png');
        mark('写错、漏写都会被标出来\nWrong and missing words are highlighted');
        await sleep(4000);

        // 6. 复述
        await page.getByRole('button', { name: '复述', exact: true }).click();
        mark('复述：只看关键词覆盖\nRetell: keyword coverage only');
        await sleep(2000);
        await page.locator('button[aria-label="开始复述"]').click();
        await sleep(6500);
        await page.locator('button[aria-label="结束复述"]').click();
        await page.getByText('关键词覆盖').first().waitFor({ timeout: 90_000 });
        await sleep(3000);
        await shot(page, 'demo-retell.png');
        mark('不要求逐字一致，说出关键信息即可\nKey ideas matter, not exact wording');
        await sleep(4000);

        // 7. 场景对话
        await clickNav(page, '场景对话');
        mark('场景对话：从当前台词生成角色扮演\nScene dialogue from the current line');
        await sleep(2500);
        await page.getByRole('button', { name: /云端模型/ }).first().click();
        await sleep(600);
        await page.getByRole('button', { name: '生成场景' }).click();
        await page.getByRole('button', { name: '结束并复盘' }).waitFor({ timeout: 180_000 });
        await sleep(2500);
        await shot(page, 'demo-dialogue-scene.png');
        mark('AI 扮演一个角色，你扮演另一个\nAI plays one role, you play the other');
        await sleep(4500);

        await page.getByPlaceholder('用英文回应；可以先录音，再改文字')
            .fill('Hi Rose, I lost my phone this morning. Can you help me?');
        await sleep(1000);
        await page.getByRole('button', { name: '发送' }).click();
        await waitFor(async () => page.evaluate(() => {
            const textarea = document.querySelector('textarea');
            return Boolean(textarea && !textarea.disabled);
        }), 180_000, 'assistant reply');
        await sleep(3500);
        mark('语音或文字都行，说完给具体复盘\nSpeak or type; get specific feedback');
        await sleep(2000);

        await page.getByRole('button', { name: '结束并复盘' }).click();
        await page.getByText('客观统计').waitFor({ timeout: 180_000 });
        await sleep(3500);
        await shot(page, 'demo-dialogue-review.png');
        mark('统计 + 逐句建议，好句一键入复习\nStats + line feedback; good lines to review');
        await sleep(5000);
        const addButtons = page.getByRole('button', { name: '加入复习' });
        if (await addButtons.count() > 0) {
            await addButtons.first().click();
            await sleep(2000);
        }

        // 8. 学习台
        await clickNav(page, '学习台');
        await sleep(3500);
        await shot(page, 'demo-dashboard.png');
        mark('学习台：三类练习合成一个数字\nThe dashboard combines all three');
        await sleep(4000);

        mark('能做的一定做，做不到的不假装\nDo what can be done honestly');
        await sleep(3500);

        const endWall = Date.now();
        capturing = false;
        await capturePromise;
        log('frames', frames.length, 'duration', ((endWall - startedAt) / 1000).toFixed(1));

        // 字幕：每段从本段开始持续到下一段
        const srt = marks.map((item, index) => {
            const next = marks[index + 1];
            const end = next ? next.at : (endWall - startedAt) / 1000 + 0.8;
            return `${index + 1}\n${srtTime(item.at)} --> ${srtTime(end)}\n${item.text}\n`;
        }).join('\n');
        fs.writeFileSync(SUBS, srt, 'utf8');

        await buildVideo(frames, frames.at(-1).ts + 1.2);
        await burnSubtitles();
        log('done');
    } finally {
        try {
            await browser?.close();
        } catch {
            // 忽略
        }
        child.kill();
    }
}

main().catch((error) => {
    console.error('[demo] FAILED', error);
    process.exitCode = 1;
});
