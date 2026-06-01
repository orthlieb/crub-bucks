# Sound effects

Drop royalty-free clips here to override the built-in synthesized cues. Each
file is optional — if it's missing, the app plays a synthesized fallback (see
`src/lib/sound.ts`). Pixabay's Content License (no attribution required) is a
good source.

Expected filenames (MP3):

| File                  | Plays when…                              |
| --------------------- | ---------------------------------------- |
| `cash-register.mp3`   | you gain CB (won a bet, got paid)        |
| `slide-whistle.mp3`   | you lose CB (lost a bet, paid someone)   |
| `hello-there.mp3`     | you receive a friend request             |
| `yes.mp3`             | a bet you're in goes live                |
| `no.mp3`              | a bet you're in is called off            |

Keep them short (< ~1s) and reasonably quiet. They're played at 50% volume.
