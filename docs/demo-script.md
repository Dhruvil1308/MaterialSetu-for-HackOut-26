# Pitch video — voiceover

`docs/demo-video.mp4` is **1 minute 56 seconds**, 1280×720, and has **no audio**.
It is a real recording of the working product: `scripts/record-demo.cjs` starts its
own API on a throwaway database and performs the whole exchange — buyer, two
suppliers, reviewer — in a real browser. Nothing is mocked or sped up.

Every shot below was widened to hold the **Hindi** reading, which runs longer than
the English. Both languages fit the same cut, so you can produce either without
re-editing the picture.

## Make the audio

The text is ready to feed straight to a text-to-speech service, one file per shot:

```
docs/voiceover/en/01-open.txt   …   docs/voiceover/en/12-close.txt
docs/voiceover/hi/01-open.txt   …   docs/voiceover/hi/12-close.txt
docs/voiceover/en.txt           the whole English read, in order
docs/voiceover/hi.txt           the whole Hindi read, in order
```

Save each generated clip beside its text file, keeping the name:
`docs/voiceover/hi/03-search.wav`. WAV, MP3, M4A, OGG and FLAC all work.

## Put it together

```bash
export FFMPEG=$(python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")
node scripts/merge-voiceover.cjs hi     # or: en
```

That writes `docs/demo-video-hi.mp4`. Each clip is placed at its marked second and
the video is copied rather than re-encoded, so it is quick and loses no quality.
If a clip runs past its shot the tool says which one and by how much, instead of
letting it talk over the next scene.

## English

| Segment | At | Shot | Say |
| --- | --- | --- | --- |
| `01-open` | 0:00.0 | 5.3s | MaterialSetu. A local exchange for surplus packaging material. |
| `02-problem` | 0:05.6 | 8.9s | Every day, one factory throws away exactly what the factory next door is buying. |
| `03-search` | 0:14.8 | 10.4s | So we start where the buyer starts. Fifty kilos of PET, within thirty kilometres. Plain words. |
| `04-pool` | 0:25.5 | 8.3s | No single supplier has fifty kilos. Three nearby ones together do. |
| `05-trust` | 0:34.1 | 10.2s | One plan: twelve kilometres of driving, thirteen seventy-seven rupees. And you can see why this supplier scores ninety-three. |
| `06-request` | 0:44.6 | 6.7s | The buyer sends one request. Nothing is reserved yet. |
| `07-accept` | 0:51.6 | 9.2s | Each supplier answers for themselves. Only when they accept is their stock held. |
| `08-handover` | 1:01.1 | 13.3s | Then both sides type what actually changed hands. The numbers must match, or neither counts. What never moved goes back on sale. |
| `09-gst` | 1:14.7 | 16.7s | A supplier submits their GST number, but the points come only when a person opens the certificate, writes what they checked, and approves it. We don't pretend to be the GST registry. |
| `10-language` | 1:31.7 | 5.5s | And you can ask in your own language. |
| `11-pallets` | 1:37.5 | 11.0s | Hindi, Gujarati or English. Twenty wooden pallets, found nearby. |
| `12-close` | 1:48.8 | 6.9s | MaterialSetu. On the web and on Android today. Built by Team Tech Titans. |

## हिंदी

| सेगमेंट | समय | अवधि | बोलें |
| --- | --- | --- | --- |
| `01-open` | 0:00.0 | 5.3s | मटीरियलसेतु। बची हुई पैकेजिंग सामग्री के लिए एक लोकल एक्सचेंज। |
| `02-problem` | 0:05.6 | 8.9s | हर दिन, एक फैक्ट्री वही चीज़ फेंक देती है जो बगल वाली फैक्ट्री खरीद रही होती है। |
| `03-search` | 0:14.8 | 10.4s | तो शुरुआत वहीं से, जहाँ से खरीदार करता है। तीस किलोमीटर में, पचास किलो पी ई टी। सीधी भाषा में। |
| `04-pool` | 0:25.5 | 8.3s | किसी एक सप्लायर के पास पचास किलो नहीं। पर पास के तीन के पास मिलाकर हैं। |
| `05-trust` | 0:34.1 | 10.2s | एक ही प्लान: बारह किलोमीटर, तेरह सौ सतहत्तर रुपये। और दिखता है कि इस सप्लायर को तिरानवे अंक क्यों मिले। |
| `06-request` | 0:44.6 | 6.7s | खरीदार एक ही रिक्वेस्ट भेजता है। अभी कुछ भी रिज़र्व नहीं हुआ। |
| `07-accept` | 0:51.6 | 9.2s | हर सप्लायर अपनी तरफ़ से जवाब देता है। जब वे हाँ कहते हैं, तभी उनका माल रुकता है। |
| `08-handover` | 1:01.1 | 13.3s | फिर दोनों पक्ष लिखते हैं कि असल में कितना माल गया। आँकड़े मिलने चाहिए, वरना कोई नहीं माना जाता। जो नहीं गया, वह वापस बिक्री पर। |
| `09-gst` | 1:14.7 | 16.7s | सप्लायर अपना जी एस टी नंबर देता है, पर अंक तभी मिलते हैं जब कोई व्यक्ति सर्टिफ़िकेट देखकर, जाँच लिखकर मंज़ूरी दे। हम जी एस टी रजिस्ट्री होने का दावा नहीं करते। |
| `10-language` | 1:31.7 | 5.5s | और आप अपनी भाषा में पूछ सकते हैं। |
| `11-pallets` | 1:37.5 | 11.0s | हिंदी, गुजराती या अंग्रेज़ी। बीस लकड़ी के पैलेट, पास में ही मिल गए। |
| `12-close` | 1:48.8 | 6.9s | मटीरियलसेतु। आज वेब पर और एंड्रॉइड पर। बनाया है टीम टेक टाइटन्स ने। |

## Notes for the read

- **Pace.** Around 140 words a minute in English, a little slower in Hindi. The
  shot lengths already assume this; do not rush to fill them.
- **Numbers.** Say them as words — "thirteen seventy-seven rupees", "तेरह सौ
  सतहत्तर". Most engines mangle `₹1,377.60`.
- **GST** is read as three letters in both languages: "जी एस टी".
- **Silence is fine.** Where a shot outlasts its line, let the picture carry it.

## Doing both languages

Two uploads of the same picture is the simplest answer, and each reads at its own
pace. If you want one video, put English over the first half — how a deal is made
— and Hindi over the second — why it can be trusted. The halves are separable, so
it does not feel arbitrary. Avoid alternating sentence by sentence; it reads as
indecision rather than reach.

## Re-recording the picture

```bash
export OPENAI_API_KEY=sk-...     # so the Hindi search shot returns pallets
export FFMPEG=$(python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")
node scripts/record-demo.cjs
```

It prints the real start time of every shot as it records. Paste those into
`docs/voiceover/segments.json` if you change the pacing.
