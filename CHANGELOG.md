# Changelog

## 0.4.0

- Each take also writes `<take>.view/film.html`: the take moving in on each click with the pointer drawn in, as a film of
  its own that a film uses as one clip in place of the video, with the same `#t=` (OpenFilm 0.3). The video and the
  pointer page inside move by CSS keyframes, which render about as fast as plain video; the camera page, which holds
  the video inside a page, took 1.2 s of waiting for every frame in the trials (a 22 s take: 805 s against 110 s). The
  camera page is no longer written for new takes; `camera` keeps one up to date beside an older take.
- `check film.html` says what is wrong with the clips of takes in a film: a clip that runs past the take's end, a
  pointer page that is not in its video's box, a click on a plain video with no pointer, a camera page that has a view.
- A take is as long as its file: the frames are counted, so a clip may end where the record says. Before, the record
  could be a few thousandths of a second longer than the file and `look` refused the clip.
- A take is converted to BT.709 and tagged so: a browser reads untagged video as BT.709, and the take's colors came out
  a few levels off in every film (a green that a BT.601 decode gives as 125 read 114).
- `openfilm.json`: `platforms` is `windows`, so OpenFilm does not offer it elsewhere, and `needs` says Windows and
  FFmpeg 8, in the five languages. A missing space in the Korean details.
- `evals/README.md`: the requests it was tried on, with and without the skill, `evals/measure.mjs`, the script that
  measured both films, and `evals/make-take.mjs`, which films a take of the test window with scripted input.
- The test that stops a take from the command line waits until the take is filming, and the tests that film allow 300 s
  each. On a busy machine the capture took longer than the two seconds and the 120 s they assumed.
- `demo/make.mjs` cuts the README's GIF from the view and renders with OpenFilm 0.3.0.

## 0.3.0

- `guide` writes a take out as a step-by-step guide: a picture of each click with the spot outlined and a heading for each
  mark.

## 0.2.0

- `moments` prints where each mark and click falls on the film, for voice-over; the brief covers voice and other
  languages.

## 0.1.0

- First version: film a Windows program while the person works it, with a smooth pointer page and a camera page that
  moves in on each click. A real Excel take cut in OpenFilm for the README's GIF and the skill's cover.
