#!/usr/bin/env python3
"""Pre-record short English and Hindi coach lines with a neural TTS voice."""
import asyncio
import os
import edge_tts

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "voice")
VOICES = {"en": "en-IN-NeerjaNeural", "hi": "hi-IN-SwaraNeural"}

LINES = {
    "en": {
        "count-3": "Three.",
        "count-2": "Two.",
        "count-1": "One.",
        "go": "Go!",
        "hold-still": "Hold still.",
        "jump-now": "Jump now!",
        "keep-going": "Keep going.",
        "great": "Great. Rest a moment.",
        "try-again": "Let us try that again.",
        "cover-camera": "Cover the camera softly. Hold still.",
        "rest": "Good. Rest.",
        "coach-cmj": "Hold the phone on your chest. Or tie it with a scarf. Stand still. When I say go, jump up high and land softly.",
        "coach-repeat": "Keep the phone on your chest. When I say go, jump again and again until I say stop.",
        "coach-balance": "Hold the phone on your chest. Lift one foot. Stand like a tree. Try not to hop.",
        "coach-situp": "Lie down. Bend your knees. Put the phone on your chest. Sit up, then lie back. A friend can hold your feet.",
        "coach-react": "Hold the phone in your hand. Wait. When the screen turns green, tap it. Do not tap early.",
        "coach-step": "Find a low step. Hold the rail. Step up and down. Then put one fingertip on the back camera and hold still.",
        "coach-sprint": "Mark a start and a finish. Wait for go. Run straight past the finish. Then tap the button.",
        "coach-shuttle": "Two marks, a short run apart. Run there and back, four times. Tap the button at each turn.",
    },
    "hi": {
        "count-3": "तीन।",
        "count-2": "दो।",
        "count-1": "एक।",
        "go": "जाओ!",
        "hold-still": "चुपचाप खड़े रहो।",
        "jump-now": "अभी कूदो!",
        "keep-going": "जारी रखो।",
        "great": "बहुत अच्छा। थोड़ा आराम करो।",
        "try-again": "चलो, एक बार और करते हैं।",
        "cover-camera": "कैमरे को हल्के से ढको। चुपचाप रहो।",
        "rest": "अच्छा। आराम करो।",
        "coach-cmj": "फ़ोन को छाती पर पकड़ो। या दुपट्टे से बाँधो। चुप खड़े रहो। जब मैं जाओ कहूँ, ऊपर कूदो और हल्के से उतरो।",
        "coach-repeat": "फ़ोन छाती पर ही रखो। जब मैं जाओ कहूँ, बार-बार कूदते रहो। जब मैं रुकने को कहूँ, रुक जाना।",
        "coach-balance": "फ़ोन छाती पर रखो। एक पाँव उठाओ। पेड़ की तरह खड़े रहो। उछलो मत।",
        "coach-situp": "लेट जाओ। घुटने मोड़ो। फ़ोन छाती पर रखो। उठो, फिर लेट जाओ। दोस्त पाँव पकड़ सकता है।",
        "coach-react": "फ़ोन हाथ में लो। रुको। जब स्क्रीन हरी हो, तब दबाओ। जल्दी मत दबाना।",
        "coach-step": "एक नीची सीढ़ी लो। रेलिंग पकड़ो। ऊपर-नीचे कदम रखो। फिर एक उँगली पीछे के कैमरे पर रखो और चुप रहो।",
        "coach-sprint": "शुरू और अंत पर निशान लगाओ। जाओ का इंतज़ार करो। सीधे अंत तक दौड़ो। फिर बटन दबाओ।",
        "coach-shuttle": "दो निशान लगाओ, थोड़ी दूरी पर। चार बार आना-जाना है। हर मोड़ पर बटन दबाओ।",
    },
}


async def main():
    for lang, voice in VOICES.items():
        folder = os.path.join(OUT, lang)
        os.makedirs(folder, exist_ok=True)
        for clip_id, text in LINES[lang].items():
            path = os.path.join(folder, f"{clip_id}.mp3")
            communicate = edge_tts.Communicate(text, voice, rate="-10%")
            await communicate.save(path)
            size = os.path.getsize(path)
            print(f"{lang}/{clip_id}.mp3 {size}")


if __name__ == "__main__":
    asyncio.run(main())
