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
- **Clear where to look**, at the size it will be watched: the click, its text and its result readable on that
  screen, a phone too when the demo is vertical.
- **Nothing private in any frame**: keys, passwords, emails, names, customer data, other people's messages. Filming
  one window leaves the rest of the screen out; what is in that window is hidden, or filmed again with demo data.
- **Honest time.** Waiting can go; where speed is what the app sells, the real time stays or the film says it was
  shortened.
- **Every moment the voice or a title points at is in the take**: a click, or a mark the person pressed at it.

## What you have

`node <this skill's folder>/scripts/record-app.mjs` films a take on Windows. `start` puts a record bar on the person's
screen and returns at once: they press Start, work the app, press Mark at each moment worth naming and Stop when done;
`wait` gives the take. Only the window (or a screen) is filmed, never the bar. Beside the video it writes the take's
record (every pointer move and click, the marks), a page that draws the pointer, smoothed, with its clicks, laid over
the video with the same `at`, `#t=` and box, and a camera page: the take moving in on each click with the pointer
drawn in, used in place of the video in film.html with the same `#t=`; `camera` changes how far it moves in without
filming. A page plays at one speed: clips sped up stay plain video. `--help` says the rest. It builds its Windows
helper, `<this skill's folder>/scripts/deskrec.cs`, once with the C# compiler Windows ships; filming a window needs
FFmpeg 8 or later, and `install` downloads one (87 MB): ask first.

A take is a recording like any other, a clip of the film: trimmed with `#t=`, sped up with `speed`, never re-encoded.
`look` checks the film, `get` brings voice, music and sound; and anything you can make pictures and motion with.

## With the person

What they ask for comes before anything here. They do the filming, so tell them before the bar comes up: which app
and window, what to do (put it in the bar's note, in their words), and what to mark. Ask who the demo is for and the
one thing it must show, without holding up the work. When done, tell them in a few lines what it shows, what was
left out or hidden, and which takes make it.
