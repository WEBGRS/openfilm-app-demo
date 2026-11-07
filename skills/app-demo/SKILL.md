---
name: app-demo
description: A demo of a desktop app (any Windows program, such as an editor, a spreadsheet, a design tool or a game) filmed while the person works it, with a smooth pointer and a camera that moves in on each click. Use when the person wants a product demo, tutorial or feature video of software that runs outside the browser, on Windows (桌面软件演示, 录软件, 软件教程, 录屏演示).
---

# App demo

Make the demo that shows this app at its best and is effortless to follow: the viewer always knows where to look,
sees each click land, never waits, and could do the same in the app today.

## What defines it

The person's own hands in the real app, filmed so that every click is known: the camera goes where the action is
because the take says where it was, not because someone guessed from the picture. A screen recording without its
record is a screen demo, not this.

## What has to be true

- **The real app.** Its own windows, data and results, as the person works it; never a redrawn interface or a result
  that did not happen.
- **Clear where to look**, at the size it will be watched: the camera on each click, the pointer drawn, the click's
  text and its result readable on that screen, a phone too when the demo is vertical.
- **Nothing private in any frame**: keys, passwords, emails, names, customer data, other people's messages. Filming
  one window leaves the rest of the screen out; what is in that window is hidden, or filmed again with demo data.
- **Honest time.** Waiting can go; where speed is what the app sells, the real time stays or the film says it was
  shortened.
- **Every moment the voice or a title points at is in the take**: a click, or a mark the person pressed at it.

## What you have

`node <this skill's folder>/scripts/record-app.mjs` films a take on Windows. `start` puts a record bar on the person's
screen and returns at once: they press Start, work the app, press Mark at each moment worth naming and Stop when done;
`wait` gives the take. Only the window (or a screen) is filmed, never the bar. It builds its Windows helper,
`<this skill's folder>/scripts/deskrec.cs`, once with the C# compiler Windows ships; filming a window needs FFmpeg 8 or
later, and `install` downloads one (87 MB): ask first.

Beside the video the take has its record (every pointer move and click, the marks) and what is made from it:

- `<take>.view/film.html`, a film of its own: the take moving in on each click, the smoothed pointer drawn in. Use it
  as one clip of your film in place of the video, with the same `#t=` (never past the take's end). The film crops it
  at its box, so it can be a card as well as the whole frame, and it renders about as fast as plain video.
- `<take>.cursor.html`, the pointer alone, to lay over a plain video with the same `at`, `#t=` and box. A page plays at
  one speed, so a clip you speed up is plain video, with no camera.

`camera <take> --zoom <n|off>` changes how far the view moves in, nothing filmed. `check film.html` says what is wrong
with the clips of takes in it: past the take's end, a pointer page off its video, a click with no pointer; run it
before you finish. `--help` says the rest.

A take is a recording like any other, a clip of the film: trimmed with `#t=`, sped up with `speed`, never re-encoded.
`look` checks the film, `get` brings voice, music and sound; and anything you can make pictures and motion with.

Voice-over is said over its moment: `moments` prints where each mark and click falls on the film. Another language
uses the same takes: its lines translated, voiced with `get tts` on a track of their own at the same moments, the
other languages' tracks muted, so the subtitles come from the one heard. `guide` writes a take out as a guide, a
picture of each click with its spot outlined; write what each step does in the person's words.

## With the person

What they ask for comes before anything here. They do the filming, so tell them before the bar comes up: which app
and window, what to do (put it in the bar's note, in their words), and what to mark. Ask who the demo is for, the one
thing it must show and its languages, without holding up the work. When done, tell them in a few lines what it shows,
what was left out or hidden, and which takes make it.
