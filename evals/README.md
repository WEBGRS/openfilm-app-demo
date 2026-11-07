# Evals

How this skill was tried. Nothing here goes to the agent: only `skills/` is installed.

Two requests, each run once with the skill and once without. On these two the skill was not clearly better. Both arms were given the recorder's own files beside the take, including its view film, and both used its camera, so the camera moves match. What differed is where the voice lines sit against the person's marks, the loudness of the voice and, in request 2, how the film was rendered. A person did not film the takes, and `start` with a real person at the record bar was not part of the trial.

- Skill: app-demo 0.4.0, from the working tree before it was committed.
- Agent: Claude Code 2.1.310, headless, model `claude-sonnet-5-5` as the init event of every run reports. Each arm was an isolated project outside the home folder, and the skill folder was the only difference. Both `with` arms loaded the skill through the Skill tool.
- OpenFilm: 0.3.0, installed at that exact version.
- Date and machine: 2026-11-07, Windows 11, a busy machine, other trials running at the same time. Wall times below move with that load.
- Material: two takes of this repository's own test window (`deskrec.cs testwin`), filmed by `record-app.mjs` with the record bar hidden and the pointer scripted (`evals/make-take.mjs`, `evals/takes/`). The scripts drive no real mouse and no desktop. The window paints a gradient, a gold square and a frame counter, so nothing in the frames is private. The takes are not in the repository, and no third-party media was used.
  - take 1: window 1600 x 900, 20.8 s, 6 clicks, marks `first`, `middle`, `last`.
  - take 2: window 1280 x 800 that repaints twice a second, 32.8 s, 9 clicks, marks `menu`, `done`.
- Beside each take both arms got what the recorder writes: its record, the pointer page and the view film.
- Voice: local-voice on 127.0.0.1:4848, offered to every arm. No transcript was needed or supplied, because the takes have no speech.
- Seen: read from contact sheets, and from two full-size frames of request 2 (14 s, both films). Nobody watched playback in Studio. Studio was not used to open the view film.

## Measures

`evals/measure.mjs` runs on a finished MP4, whichever arm made it. It needs Node 22, ffmpeg and ffprobe, and the take:

```
node evals/measure.mjs film.mp4 --take take1.mp4 --film film.html --record take1.record.json
```

- Zoom: the test window's background is a gradient, so the range of green a frame spans says how much of the window it shows. Against the whole take this is the camera's zoom (1 is the whole window). The script gives the share of the film at 1.25 or more, the number of stretches of 0.4 s or more at that zoom, the highest zoom and the largest change within 0.2 s. The camera's own ease gives a change of about 0.4 within 0.2 s, so that figure barely tells films apart. A 1.7 times crop of the take reads 1.71, and the whole take reads 1.
- Sound: the longest silence of a second or more at -40 dB, and the integrated loudness.
- Voice against the take: from film.html and the take's record, where each click and mark falls on the film. A mark has a line when a sound clip starts from 0.5 s before it to 2 s after it. Every sound clip counts as a line, and no film here has music. The last figure is the median distance from a line's start to the nearest click or mark.
- Render time and the agent's minutes, turns and cost come from the run's own log.

The same script can be run on films from other takes: film new ones with `node evals/make-take.mjs evals/takes/take1.json <folder>`. Their timings differ a little from the ones used here.

## Request 1: take 1, English, 16:9

```
I screen-recorded a small test window from the screen recorder I'm building. The video is assets/take1.mp4, and the files the recorder wrote next to it are in the same folder. Make a demo of about 20 seconds from it for the project's README: 16:9, with an English voice-over and subtitles. The window only has a moving square and a frame counter, so the demo is about what the recorder does: the smooth pointer, and the view moving in on each click. I pressed Mark at three moments, first, middle and last. When it's done, tell me where the file is.
```

| | with 0.4.0 | without |
| --- | --- | --- |
| length, size | 20.8 s, 1920 x 1080 | 20.8 s, 1600 x 900 |
| share of the film zoomed, stretches, highest zoom | 73%, 2, 1.82 | 73%, 2, 1.82 |
| largest zoom change within 0.2 s | 0.41 | 0.41 |
| clicks and marks on the film | 6 of 6, 3 of 3 | 6 of 6, 3 of 3 |
| marks with a line | 3 of 3 | 2 of 3 |
| median distance, line start to nearest click or mark | 0.07 s | 1.34 s |
| voice lines, longest silence | 4, 3.67 s | 4, 4.63 s |
| loudness | -26.4 LUFS | -17.2 LUFS |
| render | 624 frames, 117 s | 624 frames, 112 s |
| agent: minutes, turns, cost | 7.7, 30, $0.38 | 5.5, 27, $0.40 |

Seen, with: the view film as one clip over the whole frame, the camera moving in on each click, the pointer drawn, an English caption track. It ran `moments` and put lines at 3.3 s, 10.5 s and 16.5 s, where the marks are at 3.4 s, 10.5 s and 16.6 s. It ran `check` on two versions of the film, and it found nothing in either. The voice is quiet and the agent did not raise it. At 3.8 s a subtitle crosses the moving square for a moment.

Seen, without: the agent read the view film and the record, copied the view's keyframes into a project of its own at the take's size, and drew a caption track. Its lines sit at 0.3 s, 4 s, 8.2 s and 16.55 s, so the first mark at 3.4 s and the middle one at 10.5 s have no line starting near them. It raised the voice to -17.2 LUFS. The pictures of the two films match frame for frame apart from the subtitles.

## Request 2: take 2, Chinese, 9:16

```
我给自己做的录屏工具录了一段测试窗口的视频：assets/take2.mp4，录屏工具生成的其他文件就在同一个文件夹里。帮我用它做一个 30 秒左右的竖屏（9:16）视频，发抖音用，要中文旁白和字幕，讲这个工具会做什么：每次点击时画面自动推近，指针是平滑的。窗口里只有一个会动的方块，不用解释它。我录的时候按了两次标记：menu 和 done。做完告诉我文件在哪。
```

| | with 0.4.0 | without |
| --- | --- | --- |
| length, size | 30.5 s, 1080 x 1920 | 29.8 s, 1080 x 1920 |
| share of the film zoomed, stretches, highest zoom | 67%, 3, 1.88 | 70%, 3, 1.94 |
| largest zoom change within 0.2 s | 0.36 | 0.38 |
| clicks and marks on the film | 9 of 9, 2 of 2 | 9 of 9, 2 of 2 |
| marks with a line | 2 of 2 | 0 of 2 |
| median distance, line start to nearest click or mark | 0.74 s | 1.15 s |
| voice lines, longest silence | 6, 2.34 s | 7, 2.28 s |
| loudness | -17.5 LUFS | -14.2 LUFS |
| render | 915 frames, 149 s | 894 frames, 64 s, after a 60 frame render of 283 s |
| agent: minutes, turns, cost | 6.6, 27, $0.36 | 74.2, 6 as reported, $0.90 |

Seen, with: the view film as a card 1080 px wide in the middle of the frame, a title above it and subtitles below, a caption track. The camera moves inside the card and is cut off at its edge, which a film laid over the whole frame could not do. It ran `moments`, put lines at `menu` (2.9 s, line at 3.6 s) and `done` (27.7 s), and raised the voice to -17.5 LUFS. It ran `check` once.

Seen, without: a title above the card, two labels under it that light up as the voice moves from one subject to the other, subtitles below. It put the camera on the clips as CSS keyframes, with a negative delay for the trimmed start. It computed its lines from the record and did not use `moments`: the `done` line starts 2.1 s before the mark and runs over it. OpenFilm rendered the film at 731 x 1300, and the agent enlarged it to 1080 x 1920 with ffmpeg and burned the subtitles in with ffmpeg after the render, without `render --subtitles`. In the frame read at 14 s the picture is softer than in with, with blocky bands in the gradient. Most of its 74 minutes passed in renders it ran at twice the size (`--scale 2`) on the busy machine.

## Cost of the camera, 0.3.0 against 0.4.0

The 0.3.0 camera was a page with the take's video inside it, which sets the video's time for every frame. The 0.4.0 view film moves the plain video and the pointer page by CSS keyframes, which OpenFilm 0.3.0 allows on any clip. The same 2 s of take 1 (60 frames, 4 s to 6 s) rendered on the same busy machine, the order reversed in the second round. Each cell is wall seconds and CPU seconds of the render's process tree, polled every two seconds.

| 2 s of film | round 1 | round 2 |
| --- | --- | --- |
| camera page (0.3.0) | 75 / 18 | 237 / 32 |
| view film (0.4.0) | 28 / 23 | 70 / 24 |
| plain video with the pointer page over it, no camera | 36 / 21 | 103 / 26 |

On a quiet machine the whole 22 s take took 805 s as the camera page and 110 s as video and pointer page on keyframes. The camera page's CPU time is no higher than the others: it waits for the browser to seek the video for every frame, about 1.2 s a frame. The films rendered at full size in the arms above took 0.16 to 0.19 s a frame.

## Defects

Found and fixed in 0.4.0, each with a test:

- The take's colors were converted with BT.601 and left untagged, so a browser, which reads untagged video as BT.709, showed a green of the test window as 114 where a BT.601 decode gives 125. The take is now converted and tagged BT.709.
- The record's length could be a few thousandths of a second longer than the file, so `look` refused a clip that ended where the record said. The frames are counted now.
- The test that stops a take from the command line stopped it after two seconds, before the capture had started on a busy machine. It waits until the take is filming.

Left:

- With the skill, the voice in request 1 stayed at -26.4 LUFS. The brief says nothing about loudness, which OpenFilm's own manual covers with `look --loudness`.
- A subtitle can cross what the take shows, as the square at 3.8 s in request 1.

## Not tried

- A person filming with the record bar (`start`, Start, Mark, Stop).
- A real application, typing, menus and dialogs (`--area`), and a whole screen (`--screen`).
- Opening the view film or the films in Studio, and editing a clip of the view there.
- `guide`, beyond its unit test. `install`, which downloads FFmpeg.
- Takes longer than 33 s. The view film holds 222 keyframe stops for take 1 and 304 for take 2, and grows with the movement.
- OpenFilm before 0.3.0, which cannot use a film as a clip.
