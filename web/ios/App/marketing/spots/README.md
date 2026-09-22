# The 20s and 30s spots

Built by `make-spot.py` (picture), `make-spot-music.py` (bed), `make-voiceover.py` (lines) and
`mix-spot-audio.sh` (mix). The plans here reference `$SPOT` (a scratch dir holding the normalised
takes `norm.mp4` and `flip-norm.mp4`) and `$ICON` (the 1024px app icon); substitute before running.

```bash
cd web/ios/App/marketing
THEME=light HERO_TEST=testCspot OUT=$SPOT/spot-raw.mp4 ./record-hero.sh     # 117s take
THEME=light HERO_TEST=testDflip OUT=$SPOT/flip-raw.mp4 ./record-hero.sh     # the light->dark beat
ffmpeg -i $SPOT/spot-raw.mp4 -vsync cfr -r 30 -crf 14 -an $SPOT/norm.mp4     # same for flip
./make-spot-music.py spots/music30.json $SPOT/bed30.wav
VO_LINE="Good morning. Your upside hinges on NVIDIA's earnings. Meta's jump added fifty thousand dollars to your book." ./make-voiceover.py $SPOT/main30.wav
VO_LINE="That's your brief. Talk soon." ./make-voiceover.py $SPOT/signoff.wav
./mix-spot-audio.sh $SPOT/bed30.wav $SPOT/mix30.wav 30.0 7.6:$SPOT/main30.wav 27.2:$SPOT/signoff.wav
./make-spot.py spots/spot30.json $SPOT/spot30-silent.mp4
ffmpeg -i $SPOT/spot30-silent.mp4 -i $SPOT/mix30.wav -map 0:v -map 1:a -c:v copy -c:a aac_at -b:a 256k -movflags +faststart ../../../docs/marketing/spots/assetly-spot-30s.mp4
```

Beat times in the plans were read off frame samples of THESE takes; a new recording has a new clock.
