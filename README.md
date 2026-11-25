# DashPlayer · English Learning Edition

> An English-learning fork of [DashPlayer](https://github.com/solidSpoon/DashPlayer), built around one unit: **the video sentence**.
> This is a community modification, **not** an official DashPlayer release.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
![Electron](https://img.shields.io/badge/Electron-54-47848F?logo=electron)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)

<p align="center">
  <img src="docs/screenshots/02-shadowing.png" width="49%" alt="Word-level shadowing feedback" />
  <img src="docs/screenshots/10-dialogue-review.png" width="49%" alt="Scene dialogue review" />
</p>

## Why

Most video-based English learning stops at listening. Learners understand a line but never speak it, get specific feedback, review it, or reuse it.

This fork turns DashPlayer into a loop around the sentence you just heard:

```text
Watch → hear a line → shadow → word-level feedback → save
      → spaced review (shadow again)
      → dictation / retell → feedback
      → scene dialogue → review notes → good lines saved
```

Every item points back to `videoKey + sentenceIndex`, so the original context is never lost.

## What this fork adds

| Area | What it does |
|---|---|
| **Shadowing** | Record a line; local ASR + word alignment mark correct / wrong / missing / extra words. Honest word-level scoring — no fake pronunciation score. |
| **Spaced Review** | Review means listening and shadowing again. The backend reads the real attempt score; a pass postpones the card (1/3/7/14/30 days), a fail returns it immediately. |
| **Dashboard** | Today’s practice (shadowing + dictation/retell + dialogue turns), streak, 7-day activity. |
| **Dictation & Retell** | Word-by-word dictation check; retelling scored by keyword coverage, not exact wording. |
| **Scene Dialogue** | Builds a role-play from the current line, lets you speak or type, then produces specific feedback. Good lines go into the same review queue. |
| **Local-first models** | Dialogue can run on the bundled Qwen3.5 2B (offline) or any OpenAI-compatible endpoint (cloud or local Ollama). The UI always shows which model produced the feedback. |

### Three evaluation layers (and what is deliberately missing)

1. **Computed stats** — turns, words, targets used. Objective and reproducible.
2. **Labeled AI feedback** — grammar, word choice, rewrites; labeled “AI feedback, not an exam score”.
3. **Word-level speaking score** — only when a reference text exists (shadowing / “shadow this line”).

There is **no phoneme, stress, or intonation score** for free speech. The local recognizers output words, not phoneme alignments; producing such scores would be fake.

## Screenshots

| | |
|---|---|
| ![Shadowing](docs/screenshots/02-shadowing.png) | ![Review](docs/screenshots/04-review.png) |
| Word-level shadowing feedback | Spaced review driven by a real score |
| ![Dictation](docs/screenshots/05-dictation.png) | ![Retell](docs/screenshots/06-retell.png) |
| Dictation check | Retelling by keyword coverage |
| ![Dialogue](docs/screenshots/08-dialogue-scene.png) | ![Dialogue review](docs/screenshots/10-dialogue-review.png) |
| Scene generated from the current line | Review: stats, line feedback, good lines |
| ![Dashboard](docs/screenshots/11-dashboard.png) | ![Player](docs/screenshots/01-player.png) |
| Dashboard | The player and the current line |

## Architecture

```text
Renderer (React features)
  → featureApi → backendClient → window.electron.call
  → Main Controller → Service → Infrastructure (DB / ffmpeg / ASR / filesystem)
```

- Front end: `src/fronted/features/<domain>/`
- Back end: `controllers / services / infrastructure / ioc`
- Contracts: `src/common/contracts/**`, `src/common/api/api-def.ts`
- SQLite + Drizzle; migrations `0007`–`0010` add the learning tables.
- Shared engines: tokenization, word alignment, sentence audio, recorded speech, recorder hook, local-model adapter.

## Quick start

Requirements: Node 20+, Yarn 1.x (via Corepack), Windows/macOS/Linux (tested on Windows 11).

```bash
corepack yarn install
corepack yarn start        # development
corepack yarn package      # build in out/
```

On Windows, if Electron download is slow:

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
corepack yarn package
```

Local speech recognition / TTS runtimes and models are downloaded by `scripts/download.mjs` or configured in **Settings → Services & Resources**. The bundled local LLM (Qwen3.5 2B) is an optional download in the same settings area.

Quality gates used during development:

```bash
corepack yarn lint
corepack yarn tsc --noEmit
corepack yarn package
```

## Data and privacy

- Shadowing, dictation, and retelling audio is processed **locally**.
- When “cloud model” is selected, scene/dialogue/review text is sent to the endpoint **you** configure.
- The database lives in `%APPDATA%\DashPlayer\data\dp_db.sqlite3`; API keys live in `config.json`. Neither is committed.

## Project status

- Baseline tag: `portfolio-p5`.
- All five learning stages are implemented and tested end-to-end on Windows.
- The local 2B model can run offline but gives weaker scene relevance and feedback than cloud models; the UI labels the reviewing model.
- Not tested on macOS/Linux in this fork; the upstream project supports them.

## License and attribution

- Based on **DashPlayer 6.19.1** by solidSpoon — https://github.com/solidSpoon/DashPlayer — **AGPL-3.0**.
- This fork remains under **AGPL-3.0**; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
- If you distribute a built application, you must also make the corresponding source available under AGPL-3.0.
- Video clips used in demos/screenshots are **not** distributed with this repository; copyright remains with their owners.
- This is an independent modification, not endorsed by the upstream author.

---

## 中文简介

这是 [DashPlayer](https://github.com/solidSpoon/DashPlayer) 的英语学习修改版，以“视频句”为唯一学习单元，串起跟读打分、间隔复习、听写复述、场景对话与学习台。

- 评分只做词级，不做假音素级；对话点评标注模型来源，不冒充考试分数。
- 对话模型可切换内置本地模型（离线）或 OpenAI 兼容接口。
- 代码基于 AGPL-3.0 开源；影视素材仅本地演示，不随仓库分发。

详见 [`docs/开发流程说明-中文.md`](docs/开发流程说明-中文.md)（如果随仓库提供）。
